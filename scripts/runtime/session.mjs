import fs from 'node:fs';
import { resolveConnection, invokeConnection, payloadForBinding } from './session-connection.mjs';
import { resolveSessionModel } from './session-model.mjs';
import { handoff, readThread } from './app-session.mjs';
const [action, argument, expectedTurnId] = process.argv.slice(2);
const server = action === 'report' ? process.env.AGENT_PARENT_SERVER : process.env.NVIM;
if (!server && action !== 'report') {
  try {
    if (action === 'handoff') console.log(JSON.stringify(await handoff(JSON.parse(fs.readFileSync(argument, 'utf8').replace(/^\uFEFF/, '')))));
    else if (action === 'preview') {
      const document = argument?.endsWith('.json') ? JSON.parse(fs.readFileSync(argument, 'utf8').replace(/^\uFEFF/, '')).path : argument;
      process.stdout.write(fs.readFileSync(document, 'utf8'));
    }
    else if (action === 'status' || action === 'result') console.log(JSON.stringify(await readThread(argument, expectedTurnId), null, 2));
    else throw new Error('Usage: session.mjs handoff request.json | preview document.md | status|result thread-id [expected-turn-id]');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
} else {
if (!server) { console.error('Neovim server is unavailable; start a managed session.'); process.exit(1); }
let payload;
try {
  if (action === 'handoff') {
    payload = JSON.parse(fs.readFileSync(argument, 'utf8').replace(/^\uFEFF/, ''));
    payload.resolved_session = resolveSessionModel(process.env);
    payload.parent_model ||= process.env.AGENT_SESSION_MODEL;
    payload.parent_agent ||= process.env.AGENT_SESSION_VENDOR;
  }
  else if (action === 'preview') {
    payload = argument?.endsWith('.json') ? JSON.parse(fs.readFileSync(argument, 'utf8').replace(/^\uFEFF/, '')) : { path: argument };
  }
  else if (action === 'task-complete') {
    payload = JSON.parse(fs.readFileSync(argument, 'utf8').replace(/^\uFEFF/, ''));
    payload.resolved_session = resolveSessionModel(process.env);
  }
  else if (action === 'activity') {
    payload = { instance: process.env.AGENT_EVENT_INSTANCE,
      token: process.env.AGENT_EVENT_TOKEN, at: Date.now(), status: argument, source: 'explicit' };
  }
  else if (action === 'report') {
    const text = fs.readFileSync(argument === '-' ? 0 : argument, 'utf8');
    if (text.includes('??') && !/[^\u0000-\u007f]/.test(text)) throw new Error('인코딩 손상 의심: PowerShell은 $OutputEncoding을 UTF-8로 설정 후 재전송');
    payload = { from: process.env.AGENT_SESSION_TITLE, text };
  } else throw new Error('Usage: session.mjs handoff request.json | preview document.md|request.json | report result.md|- | task-complete request.json | activity working|idle|response_requested|interrupted|error|unknown');
  const vendor = process.env.AGENT_SESSION_VENDOR;
  if (vendor === 'codex' && process.env.CODEX_THREAD_ID && process.env.CODEX_SESSION_ID && process.env.CODEX_THREAD_ID !== process.env.CODEX_SESSION_ID) throw new Error('identity: conflicting Codex session IDs');
  const cli_session = vendor === 'codex' ? process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID
    : vendor === 'claude' ? process.env.CLAUDE_SESSION_ID : undefined;
  const binding = resolveConnection({instance:process.env.AGENT_EVENT_INSTANCE,owner:Number(process.env.AGENT_SESSION_ID),
    task_id:process.env.AGENT_TASK_ID, vendor, cli_session}, {server});
  if (action === 'activity') payload.owner = binding.owner;
  payload = payloadForBinding(binding,action,payload);
  const result = invokeConnection(binding,action,payload);
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exitCode = result.status === 0 && !/(FAIL:|PENDING:)/.test(String(result.stdout)) ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
}
