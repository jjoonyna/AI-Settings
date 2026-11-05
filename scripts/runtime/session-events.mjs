import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveSessionModel } from './session-model.mjs';

// Only events verified in Claude 2.1 and Codex 0.154/0.166 schemas are installed.
export const commonEvents = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd'];
export function activityEvent(data, vendor, env = process.env, at = Date.now()) {
  const supported = vendor === 'claude' ? [...commonEvents, 'Notification', 'PostToolUseFailure', 'StopFailure']
    : vendor === 'codex' ? [...commonEvents, 'Interrupt'] : [];
  if (!env.NVIM || !env.AGENT_EVENT_TOKEN || !env.AGENT_EVENT_INSTANCE || !Number(env.AGENT_SESSION_ID)
    || data.agent_id || (data.agent_type && !(vendor === 'claude' && data.hook_event_name === 'SessionStart'))
    || typeof data.session_id !== 'string' || !supported.includes(data.hook_event_name)) return null;
  let status = ({ SessionStart: 'idle', UserPromptSubmit: 'working', PreToolUse: 'working', PostToolUse: 'working',
    PermissionRequest: 'response_requested', Stop: 'idle', SessionEnd: 'unknown', Interrupt: 'interrupted', PostToolUseFailure: 'error', StopFailure: 'error' })[data.hook_event_name];
  if (data.hook_event_name === 'PreToolUse' && ['AskUserQuestion', 'request_user_input'].includes(data.tool_name)) status = 'response_requested';
  if (vendor === 'claude' && data.hook_event_name === 'Notification') {
    status = data.notification_type === 'idle_prompt' ? 'idle'
      : ['permission_prompt', 'elicitation_dialog'].includes(data.notification_type) ? 'response_requested' : undefined;
  }
  if (!status) return null;
  const saved = data.hook_event_name === 'SessionStart' && !env.AGENT_SESSION_ROLE
    ? resolveSessionModel({ ...env, AGENT_SESSION_VENDOR: vendor, CLAUDE_SESSION_ID: data.session_id,
        CODEX_THREAD_ID: data.session_id, CODEX_SESSION_ID: data.session_id }, data, undefined, false)
    : undefined;
  return { saved, instance: env.AGENT_EVENT_INSTANCE, owner: Number(env.AGENT_SESSION_ID), token: env.AGENT_EVENT_TOKEN,
    at, cli_session: data.session_id, turn_id: data.turn_id, event: data.hook_event_name, status, source: `${vendor}:${data.hook_event_name}` };
}
export function sendActivity(payload, env = process.env) {
  if (!payload) return;
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  return spawnSync('nvim', ['--headless', '--server', env.NVIM, '--remote-expr', `v:lua.AgentActivity64('${encoded}')`],
    { encoding: 'utf8', windowsHide: true, timeout: 2000 });
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const data = JSON.parse(fs.readFileSync(0, 'utf8'));
    sendActivity(activityEvent(data, process.argv[2]));
  } catch { /* An advisory hook never controls the CLI's permission or execution flow. */ }
}
