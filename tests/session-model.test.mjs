import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activityEvent } from '../scripts/runtime/session-events.mjs';
import { resolveSessionModel } from '../scripts/runtime/session-model.mjs';
test('exact identity and latest model are required', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-model-'));
  try {
    const id = '12345678-1234-1234-1234-123456789abc';
    const dir = path.join(root, 'sessions', '2026'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-${id}.jsonl`);
    const write = records => fs.writeFileSync(file, records.map(JSON.stringify).join('\n'));
    const env = { CODEX_HOME: root, CODEX_SESSION_ID: id, CODEX_THREAD_ID: id };
    fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id, thread_name: '계획 | 테스트' }));
    write([{ type: 'session_meta', payload: { id } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }]);
    assert.deepEqual(resolveSessionModel(env), { model: 'gpt-6.1-sol', role: 'plan', title: '계획 | 테스트', id });
    fs.appendFileSync(file, '\n' + JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-luna' } }));
    assert.deepEqual(resolveSessionModel(env), { model: 'gpt-6-luna', role: 'plan', title: '계획 | 테스트', id });
    fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id, thread_name: 'other 계획 | 테스트' }));
    assert.equal(resolveSessionModel(env).role, undefined);
    assert.equal(resolveSessionModel({ ...env, CODEX_THREAD_ID: 'wrong' }), undefined);
    write([{ type: 'session_meta', payload: { id: 'different' } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }]);
    assert.equal(resolveSessionModel(env), undefined);
    fs.writeFileSync(file, '{'); assert.equal(resolveSessionModel(env), undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Claude resume hook uses the selected ID and translates stored model names', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-resume-'));
  try {
    const id = '12345678-1234-1234-1234-123456789abc';
    const dir = path.join(root, 'projects', 'old-worktree');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id + '.jsonl'), [
      { sessionId: id, type: 'custom-title', customTitle: '계획 | 과거 작업' },
      { sessionId: id, type: 'assistant', message: { model: 'claude-opus-5-5' } }
    ].map(JSON.stringify).join('\n'));
    const env = { NVIM: 'server', AGENT_EVENT_TOKEN: 'token', AGENT_EVENT_INSTANCE: 'instance',
      AGENT_SESSION_ID: '1', CLAUDE_CONFIG_DIR: root };
    const hook = { session_id: id, hook_event_name: 'SessionStart', source: 'resume' };
    assert.deepEqual(activityEvent(hook, 'claude', env).saved,
      { id, title: '계획 | 과거 작업', role: 'plan', model: 'opus' });
    assert.deepEqual(activityEvent({ ...hook, session_title: '리뷰 | 과거 작업', model: 'claude-sonnet-5-5' }, 'claude', env).saved,
      { id, title: '리뷰 | 과거 작업', role: 'review', model: 'sonnet' });
    assert.equal(activityEvent({ ...hook, session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, 'claude', env).saved, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
