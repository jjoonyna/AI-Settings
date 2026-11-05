import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activityEvent } from '../scripts/runtime/session-events.mjs';
import { readRole, saveRole } from '../scripts/runtime/session-role.mjs';
const id = '12345678-1234-1234-1234-123456789abc';
test('roles persist per exact vendor and ID and reject conflicts or corruption', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-'));
  const env = { AI_SETTINGS_HOME: root };
  try {
    assert.equal(readRole('codex', id, env), undefined);
    saveRole('codex', id, 'work', env);
    assert.equal(readRole('codex', id, env), 'work');
    assert.equal(readRole('claude', id, env), undefined);
    assert.throws(() => saveRole('codex', id, 'plan', env));
    assert.throws(() => saveRole('codex', 'bad', 'plan', env));
    fs.writeFileSync(path.join(root, 'state', 'session-roles', 'codex', id + '.json'), '{');
    assert.throws(() => readRole('codex', id, env));
    assert.throws(() => saveRole('codex', id, 'plan', env));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('hook construction never records roles before receiver acceptance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'role-event-'));
  try {
    const env = { AI_SETTINGS_HOME: root, NVIM: 'server', AGENT_EVENT_TOKEN: 'token', AGENT_EVENT_INSTANCE: 'instance', AGENT_SESSION_ID: '1', AGENT_SESSION_ROLE: 'work' };
    const id = '12345678-1234-1234-1234-123456789abc';
    activityEvent({ session_id: id, hook_event_name: 'SessionStart' }, 'codex', env);
    assert.equal(readRole('codex', id, env), undefined);
    const dir = path.join(root, 'sessions'); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, `rollout-${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id } }));
    fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id, thread_name: '\uacc4\ud68d | legacy' }));
    const resumed = { ...env, CODEX_HOME: root, AGENT_SESSION_ROLE: '' };
    activityEvent({ session_id: id, hook_event_name: 'SessionStart' }, 'codex', resumed);
    assert.equal(readRole('codex', id, env), undefined);
    activityEvent({ session_id: 'bad', hook_event_name: 'SessionStart' }, 'codex', env);
    assert.throws(() => readRole('codex', 'bad', env));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
