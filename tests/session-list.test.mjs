import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { install } from '../scripts/install-runtime.mjs';
import { listSessions } from '../scripts/runtime/session-list.mjs';

test('lists only verified sessions in the requested directory for both CLIs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-list-'));
  try {
    const cwd = path.join(root, 'project');
    const id = '12345678-1234-1234-1234-123456789abc';
    const other = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const codex = path.join(root, 'codex');
    const claude = path.join(root, 'claude');
    const write = (file, records) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, records.map(JSON.stringify).join('\n')); };
    write(path.join(codex, 'sessions', '2026', `rollout-${id}.jsonl`), [
      { type: 'session_meta', payload: { id, cwd } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } }]);
    write(path.join(codex, 'sessions', '2026', `rollout-${other}.jsonl`), [{ type: 'session_meta', payload: { id: other, cwd: root } }]);
    write(path.join(codex, 'session_index.jsonl'), [{ id, thread_name: '계획 | codex' }]);
    write(path.join(claude, 'projects', 'project', `${id}.jsonl`), [
      { type: 'user', sessionId: id, cwd }, { type: 'custom-title', sessionId: id, customTitle: '작업 | claude' },
      { type: 'assistant', sessionId: id, message: { model: 'claude-sonnet-5-5' } }]);
    const env = { AI_SETTINGS_HOME: root, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude };
    const [c] = listSessions('codex', cwd, env);
    const [a] = listSessions('claude', cwd, env);
    assert.deepEqual([c.id, c.title, c.role, c.model], [id, '계획 | codex', 'plan', 'gpt-6.1-sol']);
    assert.deepEqual([a.id, a.title, a.role, a.model], [id, '작업 | claude', 'work', 'sonnet']);
    assert.equal(listSessions('codex', path.join(root, 'missing'), env).length, 0);
    write(path.join(codex, 'sessions', 'other', `rollout-${id}.jsonl`), [{ type: 'session_meta', payload: { id, cwd: root } }]);
    assert.equal(listSessions('codex', cwd, env).length, 0, 'duplicate identity in another cwd is ambiguous');
    fs.rmSync(path.join(codex, 'sessions', 'other'), { recursive: true });
    fs.writeFileSync(path.join(codex, 'sessions', '2026', `rollout-${other}.jsonl`), '{broken');
    assert.equal(listSessions('codex', cwd, env).length, 1, 'corrupt transcripts are excluded');
    write(path.join(claude, 'projects', 'duplicate', `${id}.jsonl`), [{ type: 'user', sessionId: id, cwd }]);
    assert.equal(listSessions('claude', cwd, env).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('isolated installation provides an executable session list', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-list-install-'));
  try {
    const home = path.join(root, 'home');
    install({ home, nvim: path.join(root, 'nvim'), mode: 'codex', skipTools: true });
    const codex = path.join(root, 'codex');
    const id = '12345678-1234-1234-1234-123456789abc';
    const dir = path.join(codex, 'sessions'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `rollout-${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id, cwd: root } }));
    const script = path.join(home, '.ai-settings', 'bin', 'session-list.mjs');
    const result = spawnSync(process.execPath, [script, 'codex', root], { encoding: 'utf8', env: { ...process.env, AI_SETTINGS_HOME: root, CODEX_HOME: codex } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout)[0].id, id);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('listing scans each directory only once regardless of session count', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-scan-'));
  const original = fs.readdirSync;
  try {
    const dir = path.join(root, 'sessions', '2026'); fs.mkdirSync(dir, { recursive: true });
    for (const id of ['12345678-1234-1234-1234-123456789abc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']) {
      fs.writeFileSync(path.join(dir, `rollout-${id}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { id, cwd: root } }));
    }
    let reads = 0;
    fs.readdirSync = (...args) => { reads++; return original(...args); };
    assert.equal(listSessions('codex', root, { AI_SETTINGS_HOME: root, CODEX_HOME: root }).length, 2);
    assert.equal(reads, 2);
  } finally { fs.readdirSync = original; fs.rmSync(root, { recursive: true, force: true }); }
});
