import test from 'node:test';
import assert from 'node:assert/strict';
import { activityEvent, commonEvents } from '../scripts/runtime/session-events.mjs';
import { mergeHooks, unmergeHookConfig } from '../scripts/config-merge.mjs';

test('CLI events distinguish prompt, permission, idle, interruption and unsupported errors', () => {
  const env = { NVIM: 'server', AGENT_EVENT_TOKEN: 'nonce', AGENT_EVENT_INSTANCE: 'instance', AGENT_SESSION_ID: '42' };
  const event = (hook_event_name, vendor = 'codex', extra = {}) => activityEvent({ session_id: 'cli-1', hook_event_name, ...extra }, vendor, env, 123);
  assert.equal(event('UserPromptSubmit').status, 'working');
  assert.equal(event('PermissionRequest').status, 'response_requested');
  assert.equal(event('PreToolUse', 'claude', { tool_name: 'AskUserQuestion' }).status, 'response_requested');
  assert.equal(event('Stop').status, 'idle');
  assert.equal(event('Interrupt').status, 'interrupted');
  assert.equal(event('Notification', 'claude', { notification_type: 'idle_prompt' }).status, 'idle');
  assert.equal(event('Notification', 'claude', { notification_type: 'permission_prompt' }).status, 'response_requested');
  assert.equal(event('Notification', 'claude', { notification_type: 'auth_success' }), null);
  assert.equal(event('StopFailure'), null);
  assert.equal(event('StopFailure', 'claude').status, 'error');
  assert.equal(event('Stop', 'codex', { agent_id: 'child' }), null);
  assert.equal(activityEvent({ session_id: 'cli' }, 'codex', {}), null);
  assert.equal(event('Stop').owner, 42);
  assert.ok(!commonEvents.includes('StopFailure'));
});

test('hook ownership preserves personal commands added before and after installation', () => {
  const original = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'personal' }] }] }, description: 'mine' };
  const managed = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'ours' }] }], UserPromptSubmit: [{ hooks: [{ command: 'ours' }] }] } };
  const merged = { ...original, hooks: mergeHooks(original.hooks, managed.hooks) };
  assert.deepEqual(mergeHooks(merged.hooks, managed.hooks), merged.hooks);
  merged.hooks.UserPromptSubmit.push({ hooks: [{ command: 'later' }] });
  const reverted = unmergeHookConfig(merged, managed, original);
  assert.deepEqual(reverted.hooks.Stop, original.hooks.Stop);
  assert.deepEqual(reverted.hooks.UserPromptSubmit, [{ hooks: [{ command: 'later' }] }]);
  assert.equal(reverted.description, 'mine');
});
