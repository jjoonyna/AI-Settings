import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('installer builder rejects invalid version before compilation', () => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/build-installer.ps1', '-Version', '../bad', '-OutputDir', 'docs/installer-exe/artifacts'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /version/i);
});

test('fixture setup propagates failures and both configurations', { skip: !process.env.ISCC_PATH, timeout: 120000 }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-settings-fixture-'));
  try {
    const payload = path.join(temp, 'payload'), output = path.join(temp, 'output');
    fs.mkdirSync(path.join(payload, 'nested'), { recursive: true }); fs.mkdirSync(output);
    fs.writeFileSync(path.join(payload, 'nested', 'check.txt'), 'ok');
    const original = fs.readFileSync('installer/AI-Settings.iss', 'utf8');
    for (const [mode, code] of [['both', 0], ['codex', 0], ['both', 13]]) {
      const resultFile = path.join(temp, 'mode.txt');
      fs.rmSync(resultFile, { force: true });
      const quote = s => s.replaceAll("'", "''");
      fs.writeFileSync(path.join(payload, 'install.ps1'), `param([string]$Mode)\nif (-not (Test-Path (Join-Path $PSScriptRoot 'nested/check.txt'))) { exit 21 }\n[IO.File]::WriteAllText('${quote(resultFile)}', ($Mode + ':' + [IntPtr]::Size))\nexit ${code}\n`);
      const iss = path.join(temp, 'fixture.iss');
      fs.writeFileSync(iss, original.replace('SelectedValueIndex := 0', `SelectedValueIndex := ${mode === 'codex' ? 1 : 0}`));
      const compile = spawnSync(process.env.ISCC_PATH, ['/Q', '/DVersion=v0.0.3', `/DPayload=${payload}`, `/DOutput=${output}`, iss], { encoding: 'utf8' });
      assert.equal(compile.status, 0, compile.stdout + compile.stderr);
      const run = spawnSync(path.join(output, 'AI-Settings-Setup-v0.0.3.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { timeout: 30000 });
      const is64 = /64/i.test(process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || '');
      assert.equal(fs.readFileSync(resultFile, 'utf8'), mode + ':' + (is64 ? 8 : 4));
      if (code) assert.notEqual(run.status, 0); else assert.equal(run.status, 0);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('installer builder rejects an incomplete payload', { skip: !process.env.ISCC_PATH }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-settings-missing-'));
  try {
    fs.mkdirSync(path.join(temp, 'scripts'));
    fs.copyFileSync('scripts/build-installer.ps1', path.join(temp, 'scripts', 'build-installer.ps1'));
    fs.writeFileSync(path.join(temp, 'install.ps1'), '');
    assert.equal(spawnSync('git', ['init', '-q', temp]).status, 0);
    assert.equal(spawnSync('git', ['-C', temp, 'add', 'install.ps1']).status, 0);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(temp, 'scripts', 'build-installer.ps1'), '-Version', 'v0.0.3', '-OutputDir', path.join(temp, 'out'), '-Iscc', process.env.ISCC_PATH], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Missing payload file/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
