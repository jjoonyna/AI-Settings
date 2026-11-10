import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { extract, publish } from '../scripts/release.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('extracts exact section preserving Korean and markdown across CRLF', () => {
  assert.equal(extract('# 기록\r\n## 0.0.30\r\nwrong\r\n## 0.0.3\r\n\r\n### 문서\r\n\r\n- 변경\r\n\r\n## 0.0.2\r\nold', 'v0.0.3'), '### 문서\r\n\r\n- 변경');
});
test('rejects invalid, missing, duplicate and empty versions', () => {
  for (const [body, tag] of [['## 0.0.3\nx', 'v0.0.3x'], ['## 0.0.2\nx', 'v0.0.3'], ['## 0.0.3\nx\n## 0.0.3\ny', 'v0.0.3'], ['## 0.0.3\n  \n## 0.0.2\nx', 'v0.0.3'], ['## 0.0.3\n### 문서\n\n### 설치', 'v0.0.3']]) assert.throws(() => extract(body, tag));
});
test('ignores HTML comments when checking for substantive content', () => {
  for (const body of ['<!-- placeholder -->', '### 문서\n<!-- 여러\n줄 -->']) {
    assert.throws(() => extract(`## 0.0.3\n${body}`, 'v0.0.3'));
  }
  const body = '<!-- 여러\n줄 -->\n### 문서\n- 실제 변경';
  assert.equal(extract(`## 0.0.3\n${body}`, 'v0.0.3'), body);
});
test('creates or edits and uploads, and propagates command failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-test-'));
  try {
    const exe = join(dir, 'setup.exe'), pdf = join(dir, 'guide.pdf'), notes = join(dir, 'notes.md');
    writeFileSync(exe, 'exe'); writeFileSync(pdf, 'pdf');
    for (const exists of [false, true]) {
      const calls = [];
      publish('v0.0.3', '## 0.0.3\n### 문서\n- 한글', [exe, pdf], notes, args => { calls.push(args); return args[1] === 'view' && !exists ? 1 : 0; });
      assert.deepEqual(calls.map(x => x[1]), ['view', exists ? 'edit' : 'create', 'upload']);
      assert.equal(calls[1].includes('--notes-file'), true);
      assert.equal(readFileSync(notes, 'utf8'), '### 문서\n- 한글');
      assert.deepEqual(calls[2].slice(-3), [exe, pdf, '--clobber']);
    }
    for (const failing of ['create', 'edit', 'upload']) assert.throws(() => publish('v0.0.3', '## 0.0.3\n- x', [exe, pdf], notes, args => args[1] === failing ? 2 : args[1] === 'view' && failing === 'create' ? 1 : 0));
    const lookupCalls = [];
    assert.throws(() => publish('v0.0.3', '## 0.0.3\n- x', [exe, pdf], notes, args => { lookupCalls.push(args); return 2; }));
    assert.equal(lookupCalls.length, 1);
    let calls = 0;
    assert.throws(() => publish('v0.0.3', '## 0.0.3\n- x', [exe, join(dir, 'missing')], notes, () => { calls++; return 0; }));
    assert.throws(() => publish('v0.0.3', '## 0.0.3\n', [exe, pdf], notes, () => { calls++; return 0; }));
    assert.equal(calls, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
