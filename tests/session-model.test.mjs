import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
    assert.deepEqual(resolveSessionModel(env), { model: 'gpt-6.1-sol', role: 'plan' });
    fs.appendFileSync(file, '\n' + JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-luna' } }));
    assert.deepEqual(resolveSessionModel(env), { model: 'gpt-6-luna', role: 'plan' });
    fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id, thread_name: 'other 계획 | 테스트' }));
    assert.equal(resolveSessionModel(env).role, undefined);
    assert.equal(resolveSessionModel({ ...env, CODEX_THREAD_ID: 'wrong' }), undefined);
    write([{ type: 'session_meta', payload: { id: 'different' } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }]);
    assert.equal(resolveSessionModel(env), undefined);
    fs.writeFileSync(file, '{'); assert.equal(resolveSessionModel(env), undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
