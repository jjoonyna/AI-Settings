import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import childProcess from 'node:child_process';
import { install } from '../scripts/install-runtime.mjs';

for (const [name, initial] of [
  ['missing binding', '{\n // personal\n "profiles": {},\n}'],
  ['legacy actions', '{"actions":[{"command":"closeWindow","keys":"ctrl+shift+w"}]}'],
  ['current keybindings', '{"keybindings":[{"id":"mine","keys":"ctrl+shift+w"}]}'],
]) test(`terminal ${name}: install, reinstall and uninstall preserve personal changes`, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-key-'));
  const home = path.join(temp, 'home'), local = path.join(home, 'AppData/Local');
  const target = path.join(local, 'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, initial);
  const previous = process.env.LOCALAPPDATA; process.env.LOCALAPPDATA = local;
  try {
    const options = { home, nvim: path.join(temp, 'nvim'), mode: 'codex', skipTools: true };
    install(options);
    const first = fs.readFileSync(target, 'utf8');
    assert.match(first, /"id"\s*:\s*"unbound"/);
    install(options); assert.equal(fs.readFileSync(target, 'utf8'), first);
    fs.writeFileSync(target, first.replace(/}\s*$/, ',\n "later": true\n}'));
    const { uninstall } = await import(pathToFileURL(path.join(home, '.ai-settings/bin/uninstall.mjs')).href);
    uninstall(home);
    const result = fs.readFileSync(target, 'utf8');
    assert.match(result, /"later": true/); assert.doesNotMatch(result, /"id"\s*:\s*"unbound"/);
    if (name === 'missing binding') assert.match(result, /\/\/ personal/);
    if (name === 'legacy actions') assert.match(result, /closeWindow/);
    if (name === 'current keybindings') assert.match(result, /"mine"/);
  } finally { if (previous === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = previous; fs.rmSync(temp, { recursive: true, force: true }); }
});

test('user changes to managed keys or unbound entry survive removal', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-edit-'));
  const home = path.join(temp, 'home'), target = path.join(home, 'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '{"keybindings":[{"id":"mine","keys":"ctrl+shift+w"}]}');
  try {
    install({ home, nvim: path.join(temp, 'nvim'), mode: 'codex', skipTools: true });
    let text = fs.readFileSync(target, 'utf8').replace('"keys":[]', '"keys":["ctrl+x"]').replace('"id":"unbound"', '"id":"later"');
    fs.writeFileSync(target, text);
    const { uninstall } = await import(pathToFileURL(path.join(home, '.ai-settings/bin/uninstall.mjs')).href); uninstall(home);
    text = fs.readFileSync(target, 'utf8'); assert.match(text, /ctrl\+x/); assert.match(text, /"id":"later"/); assert.doesNotMatch(text, /ctrl\+shift\+w"\s*}\s*,/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('invalid JSONC and linked target are left unchanged with warning', () => {
  for (const linked of [false, true]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-safe-'));
    const home = path.join(temp, 'home'), target = path.join(home, 'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
    const outside = path.join(temp, 'outside.json'); fs.writeFileSync(outside, '{broken'); fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      if (linked) { fs.rmdirSync(path.dirname(target)); const outsideDir = path.join(temp, 'outside-dir'); fs.mkdirSync(outsideDir); fs.writeFileSync(path.join(outsideDir, 'settings.json'), '{broken'); fs.symlinkSync(outsideDir, path.dirname(target), process.platform === 'win32' ? 'junction' : 'dir'); } else fs.writeFileSync(target, '{broken');
      const result = install({ home, nvim: path.join(temp, 'nvim'), mode: 'codex', skipTools: true });
      assert.match(result.report.join('\n'), /Terminal settings unchanged/); assert.equal(fs.readFileSync(target, 'utf8'), '{broken'); assert.equal(fs.readFileSync(outside, 'utf8'), '{broken');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
});

test('installation failure rolls Terminal settings back', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-rollback-'));
  const home = path.join(temp, 'home'), target = path.join(home, 'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, '{"profiles":{}}');
  const originalWrite = fs.writeFileSync;
  try {
    fs.writeFileSync = function (p, ...args) { if (String(p).endsWith('previous-manifest.json')) throw Error('forced failure'); return originalWrite.call(this, p, ...args); };
    assert.throws(() => install({ home, nvim: path.join(temp, 'nvim'), mode: 'codex', skipTools: true }), /forced failure/);
    assert.equal(fs.readFileSync(target, 'utf8'), '{"profiles":{}}');
  } finally { fs.writeFileSync = originalWrite; fs.rmSync(temp, { recursive: true, force: true }); }
});

test('JSONC comments, trailing commas and arrays of keys survive a round trip', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-jsonc-'));
  const home = path.join(temp, 'home'), target = path.join(home, 'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  const initial = '{\n "actions": [{ "command": "mine", "keys": ["ctrl+shift+w", "ctrl+x"] }], // trailing comment\n "keybindings": [ { "id": "other", "keys": "ctrl+y" } // keep comment\n ],\n}';
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, initial);
  try {
    const result = install({home, nvim:path.join(temp,'nvim'), mode:'codex', skipTools:true});
    assert.doesNotMatch(result.report.join('\n'), /Terminal settings unchanged/);
    const installed = fs.readFileSync(target, 'utf8'); assert.match(installed, /ctrl\+x/); assert.match(installed, /"unbound"/);
    const {uninstall} = await import(pathToFileURL(path.join(home,'.ai-settings/bin/uninstall.mjs')).href); uninstall(home);
    const restored = fs.readFileSync(target, 'utf8'); assert.match(restored, /keep comment/); assert.match(restored, /trailing comment/); assert.match(restored, /ctrl\+shift\+w/); assert.match(restored, /ctrl\+x/);
  } finally { fs.rmSync(temp, {recursive:true,force:true}); }
});

test('uninstall rejects a forged Terminal path', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-forged-'));
  const home = path.join(temp, 'home'), target = path.join(home, 'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json'), outside = path.join(temp, 'outside.json');
  fs.mkdirSync(path.dirname(target), {recursive:true}); fs.writeFileSync(target, '{}'); fs.writeFileSync(outside, '{"keybindings":[]}');
  try {
    install({home, nvim:path.join(temp,'nvim'), mode:'codex', skipTools:true});
    const manifestPath = path.join(home, '.ai-settings/manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestPath)); manifest.terminal.path = outside; fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const {uninstall} = await import(pathToFileURL(path.join(home,'.ai-settings/bin/uninstall.mjs')).href);
    assert.throws(() => uninstall(home), /Unsafe Terminal settings path.*retry/); assert.equal(fs.readFileSync(outside,'utf8'), '{"keybindings":[]}'); assert.ok(fs.existsSync(manifestPath));
  } finally { fs.rmSync(temp, {recursive:true,force:true}); }
});

import { installTerminal, uninstallTerminal } from '../scripts/terminal-config.mjs';

test('duplicate identity is rejected before editing rather than losing the original key', () => {
  const initial = JSON.stringify({keybindings:[{id:'mine',keys:'ctrl+shift+w'},{id:'mine',keys:'ctrl+x'}]});
  assert.throws(() => installTerminal(initial), /Ambiguous Terminal binding/);
});

test('same item rebound by user is restored exactly after reinstall', () => {
  const initial = JSON.stringify({keybindings:[{id:'mine',keys:'ctrl+shift+w'}]});
  const first = installTerminal(initial);
  const edited = first.text.replace('"keys":[]', '"keys":["ctrl+shift+w","ctrl+x"]');
  const second = installTerminal(edited, first.metadata);
  const restored = JSON.parse(uninstallTerminal(second.text, second.metadata));
  assert.deepEqual(restored.keybindings.find(x => x.id === 'mine').keys, ['ctrl+shift+w','ctrl+x']);
});

test('id containing whitespace is a personal action, not unbound', () => {
  const initial = JSON.stringify({keybindings:[{id:'un bound',keys:'ctrl+shift+w'}]});
  const result = installTerminal(initial);
  assert.equal(result.metadata.owned, true);
  const installed = JSON.parse(result.text);
  assert.deepEqual(installed.keybindings.find(x => x.id === 'un bound').keys, []);
  assert.ok(installed.keybindings.some(x => x.id === 'unbound' && x.keys === 'ctrl+shift+w'));
  assert.equal(JSON.parse(uninstallTerminal(result.text,result.metadata)).keybindings[0].keys, 'ctrl+shift+w');
});

test('missing Terminal settings reports not applied', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-missing-')), home = path.join(temp, 'home');
  try {
    const result = install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true});
    assert.match(result.report.join('\n'), /Terminal settings unchanged:.*not found/i);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('failed Terminal restoration retains manifest and uninstaller for retry', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-retry-')), home = path.join(temp, 'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'{"keybindings":[{"id":"mine","keys":"ctrl+shift+w"}]}');
  try {
    install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true});
    const installed = fs.readFileSync(target,'utf8'); fs.writeFileSync(target,'{broken');
    const bin = path.join(home,'.ai-settings/bin/uninstall.mjs'), manifest = path.join(home,'.ai-settings/manifest.json');
    const {uninstall} = await import(pathToFileURL(bin).href);
    assert.throws(() => uninstall(home), /Terminal.*retry/i);
    assert.ok(fs.existsSync(manifest)); assert.ok(fs.existsSync(bin));
    fs.writeFileSync(target,installed); uninstall(home);
    assert.equal(JSON.parse(fs.readFileSync(target,'utf8')).keybindings[0].keys,'ctrl+shift+w');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('existing unbound entry with reordered fields and comments stays user-owned', () => {
  const initial = '{"keybindings":[{ "keys": "ctrl+shift+w", /* keep */ "id": "unbound" }]}';
  const result = installTerminal(initial);
  assert.equal(result.text, initial); assert.equal(result.metadata.owned, false);
  assert.equal(uninstallTerminal(result.text, result.metadata), initial);
});

test('uninstall preserves user comments added inside managed binding', () => {
  const result = installTerminal('{}');
  const edited = result.text.replace('"id":"unbound"', '"id": /* keep */ "unbound"');
  assert.match(uninstallTerminal(edited, result.metadata), /\/\* keep \*\//);
});

test('unchanged original key is restored exactly after reinstall', () => {
  const original = '{"actions":[{"command":"closeWindow","keys":"ctrl+shift+w"}]}';
  const first = installTerminal(original), second = installTerminal(first.text, first.metadata);
  assert.equal(JSON.parse(uninstallTerminal(second.text,second.metadata)).actions[0].keys, 'ctrl+shift+w');
});

test('ambiguous restore stops removal without archiving recovery metadata', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-retry-ambiguous-')), home = path.join(temp, 'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'{"keybindings":[{"id":"mine","keys":"ctrl+shift+w"}]}');
  try {
    install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true});
    const installed = fs.readFileSync(target,'utf8');
    fs.writeFileSync(target,installed.replace('{"id":"mine","keys":[]}', '{"id":"mine","keys":[]},{"id":"mine","keys":"ctrl+x"}'));
    const {uninstall} = await import(pathToFileURL(path.join(home,'.ai-settings/bin/uninstall.mjs')).href);
    assert.throws(() => uninstall(home), /Ambiguous Terminal binding.*retry/);
    assert.ok(fs.existsSync(path.join(home,'.ai-settings/manifest.json')));
    fs.writeFileSync(target, installed); uninstall(home);
    assert.equal(JSON.parse(fs.readFileSync(target,'utf8')).keybindings[0].keys,'ctrl+shift+w');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

function injectTerminalScript(fragment, marker, extraEnv = {}) {
  const original = childProcess.spawnSync;
  childProcess.spawnSync = function(command, args, options) {
    if (command === 'powershell.exe' && args.includes('-EncodedCommand')) {
      args = [...args]; const index = args.indexOf('-EncodedCommand') + 1;
      const script = Buffer.from(args[index], 'base64').toString('utf16le');
      assert.ok(script.includes(marker));
      args[index] = Buffer.from(script.replace(marker, marker + '\n' + fragment), 'utf16le').toString('base64');
      options = { ...options, env: { ...options.env, ...extraEnv } };
    }
    return original.call(this, command, args, options);
  };
  return () => { childProcess.spawnSync = original; };
}
for (const operation of ['install', 'uninstall']) for (const fault of ['partial write','replace failure']) {
  test(`${operation} preserves original and recovery after ${fault}`, async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-atomic-')), home = path.join(temp,'home');
    const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
    const options = {home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true};
    const original = '{\n // personal\n "keybindings":[{"id":"mine","keys":"ctrl+shift+w"}],\n "profiles":{"safe":true}\n}';
    fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,original);
    let restore = () => {};
    try {
      if (operation === 'uninstall') install(options);
      const before = fs.readFileSync(target);
      const {uninstall} = operation === 'uninstall' ? await import(pathToFileURL(path.join(home,'.ai-settings/bin/uninstall.mjs')).href) : {};
      restore = fault === 'partial write' ? injectTerminalScript("$bytes=[Text.Encoding]::UTF8.GetBytes('partial'); $stream.Write($bytes,0,$bytes.Length); throw 'forced partial'", '# AI_SETTINGS_STAGE_OPEN') : injectTerminalScript("throw 'forced replacement failure'", '# AI_SETTINGS_BEFORE_REPLACE');
      if (operation === 'uninstall') assert.throws(() => uninstall(home), /retry/);
      else assert.throws(() => install(options), /Terminal staging failed|Terminal replacement failed/);
      assert.deepEqual(fs.readFileSync(target),before);
      if (operation === 'uninstall') {
        assert.ok(fs.existsSync(path.join(home,'.ai-settings/manifest.json')));
        assert.ok(fs.existsSync(path.join(home,'.ai-settings/bin/uninstall.mjs')));
      } else assert.equal(fs.existsSync(path.join(home,'.ai-settings/manifest.json')),false);
      restore(); restore = () => {};
      if (operation === 'uninstall') { uninstall(home); assert.match(fs.readFileSync(target,'utf8'), /ctrl\+shift\+w/); }
      else { install(options); assert.match(fs.readFileSync(target,'utf8'), /"unbound"/); }
    } finally { restore(); fs.rmSync(temp,{recursive:true,force:true}); }
  });
}
test('replacement preserves settings file permissions across install and uninstall', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-permissions-')), home = path.join(temp, 'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'{"profiles":{}}');
  const {spawnSync} = await import('node:child_process');
  const permissions = () => {
    if (process.platform !== 'win32') return fs.statSync(target).mode & 0o777;
    const result = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      "(Get-Acl -LiteralPath $env:AI_SETTINGS_TEST_TERMINAL).Sddl"],
      {encoding:'utf8',env:{...process.env,AI_SETTINGS_TEST_TERMINAL:target}});
    assert.equal(result.status,0); return result.stdout.trim();
  };
  try {
    const before = permissions(); install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true});
    assert.equal(permissions(),before);
    const {uninstall} = await import(pathToFileURL(path.join(home,'.ai-settings/bin/uninstall.mjs')).href); uninstall(home);
    assert.equal(permissions(),before);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});

test('failed replacement rolls back migrated legacy manifest', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'terminal-legacy-')), home = path.join(temp,'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  const legacy = path.join(home,'.agent-env-manifest.json');
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'{}'); fs.writeFileSync(legacy,'{}');
  const restore = injectTerminalScript("throw 'forced'", '# AI_SETTINGS_BEFORE_REPLACE');
  try {
    assert.throws(() => install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true}), /Terminal staging failed/);
    assert.equal(fs.readFileSync(legacy,'utf8'),'{}'); assert.equal(fs.readFileSync(target,'utf8'),'{}');
  } finally { restore(); fs.rmSync(temp,{recursive:true,force:true}); }
});

test('failed reinstall preserves current settings and previous manifest', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'terminal-reinstall-atomic-')), home = path.join(temp,'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'{"keybindings":[{"id":"mine","keys":"ctrl+shift+w"}]}');
  const options = {home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true}; let restore = () => {};
  try {
    install(options); fs.writeFileSync(target,fs.readFileSync(target,'utf8').replace('"keys":[]','"keys":["ctrl+shift+w","ctrl+x"]'));
    const before = fs.readFileSync(target), manifest = path.join(home,'.ai-settings/manifest.json'), manifestBefore = fs.readFileSync(manifest);
    restore = injectTerminalScript("throw 'forced'", '# AI_SETTINGS_BEFORE_REPLACE');
    assert.throws(() => install(options), /Terminal staging failed/);
    assert.deepEqual(fs.readFileSync(target),before); assert.deepEqual(fs.readFileSync(manifest),manifestBefore);
  } finally { restore(); fs.rmSync(temp,{recursive:true,force:true}); }
});

test('stage cannot be substituted while content handle is open', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'terminal-stage-swap-')), home = path.join(temp,'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  const victim = path.join(temp,'victim'); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'{}'); fs.writeFileSync(victim,'victim');
  const restore = injectTerminalScript("Remove-Item -LiteralPath $stage -Force -ErrorAction Stop; Copy-Item -LiteralPath $env:AI_SETTINGS_TEST_VICTIM -Destination $stage", '# AI_SETTINGS_STAGE_OPEN', {AI_SETTINGS_TEST_VICTIM:victim});
  try {
    assert.throws(() => install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true}), /Terminal staging failed/);
    assert.equal(fs.readFileSync(victim,'utf8'),'victim'); assert.equal(fs.readFileSync(target,'utf8'),'{}');
  } finally { restore(); fs.rmSync(temp,{recursive:true,force:true}); }
});

for (const operation of ['install','uninstall']) test(`${operation} retains simultaneous user save in protected backup and manifest`, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'terminal-simultaneous-')), home = path.join(temp,'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'{}');
  const options = {home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true}; let restore = () => {};
  const later = '{"later":"user edit"}';
  try {
    if (operation === 'uninstall') install(options);
    const acl = file => {
      const result = childProcess.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command', '(Get-Acl -LiteralPath $env:AI_SETTINGS_TEST_ACL).Sddl'], {encoding:'utf8', env:{...process.env,AI_SETTINGS_TEST_ACL:file}});
      assert.equal(result.status,0); return result.stdout.trim();
    };
    const originalAcl = acl(target);
    const {uninstall} = operation === 'uninstall' ? await import(pathToFileURL(path.join(home,'.ai-settings/bin/uninstall.mjs')).href) : {};
    restore = injectTerminalScript("[IO.File]::WriteAllText($source,$env:AI_SETTINGS_TEST_EDIT)", '# AI_SETTINGS_BEFORE_REPLACE', {AI_SETTINGS_TEST_EDIT:later});
    if (operation === 'install') assert.match(install(options).report.join('\n'), /user settings retained at/);
    else assert.throws(() => uninstall(home), /user settings retained at/);
    const backups = fs.readdirSync(path.dirname(target)).filter(x => x.startsWith('.ai-settings-terminal-backup-'));
    assert.equal(backups.length,1); assert.equal(fs.readFileSync(path.join(path.dirname(target),backups[0]),'utf8'),later);
    assert.equal(acl(path.join(path.dirname(target),backups[0])), originalAcl);
    assert.ok(fs.existsSync(path.join(home,'.ai-settings/manifest.json'))); assert.ok(fs.existsSync(path.join(home,'.ai-settings/bin/uninstall.mjs')));
  } finally { restore(); fs.rmSync(temp,{recursive:true,force:true}); }
});

test('changed staging identity before replacement is rejected without touching victim', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'terminal-stage-changed-')), home = path.join(temp,'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  const victim = path.join(temp,'victim'); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'{}'); fs.writeFileSync(victim,'victim');
  const restore = injectTerminalScript("Remove-Item -LiteralPath $stage -Force; Copy-Item -LiteralPath $env:AI_SETTINGS_TEST_VICTIM -Destination $stage", '# AI_SETTINGS_BEFORE_REPLACE', {AI_SETTINGS_TEST_VICTIM:victim});
  try {
    assert.throws(() => install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true}), /Terminal staging failed/);
    assert.equal(fs.readFileSync(victim,'utf8'),'victim'); assert.equal(fs.readFileSync(target,'utf8'),'{}');
  } finally { restore(); fs.rmSync(temp,{recursive:true,force:true}); }
});

for (const fault of ['after swap','source moved']) test(`${fault} retains exact recovery material and manifest`, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'terminal-uncertain-')), home = path.join(temp,'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  const original = '{"profiles":{"mine":true}}'; fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,original);
  const restore = fault === 'after swap' ? injectTerminalScript("throw 'forced after swap'", '# AI_SETTINGS_AFTER_REPLACE') : injectTerminalScript("[IO.File]::Move($source,$backup); throw 'forced moved source'", '# AI_SETTINGS_BEFORE_REPLACE');
  try {
    const result = install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true});
    assert.match(result.report.join('\n'), /outcome needs inspection; recovery path:/);
    const backups = fs.readdirSync(path.dirname(target)).filter(x => x.startsWith('.ai-settings-terminal-backup-'));
    assert.equal(backups.length,1); assert.equal(fs.readFileSync(path.join(path.dirname(target),backups[0]),'utf8'),original);
    assert.ok(fs.existsSync(path.join(home,'.ai-settings/manifest.json'))); assert.ok(fs.existsSync(path.join(home,'.ai-settings/bin/uninstall.mjs')));
  } finally { restore(); fs.rmSync(temp,{recursive:true,force:true}); }
});

test('missing source without backup is reported as unverified and retains manifest', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'terminal-missing-source-')), home = path.join(temp,'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,'{}');
  const restore = injectTerminalScript("Remove-Item -LiteralPath $source -Force; throw 'source vanished'", '# AI_SETTINGS_BEFORE_REPLACE');
  try {
    const result = install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true});
    assert.match(result.report.join('\n'), /Terminal original not verified; inspect target:/);
    assert.ok(fs.existsSync(path.join(home,'.ai-settings/manifest.json'))); assert.ok(fs.existsSync(path.join(home,'.ai-settings/bin/uninstall.mjs')));
  } finally { restore(); fs.rmSync(temp,{recursive:true,force:true}); }
});

test('invalid UTF-8 settings remain byte-identical with warning', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'terminal-invalid-utf8-')), home = path.join(temp,'home');
  const target = path.join(home,'AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
  const bytes = Buffer.concat([Buffer.from('{"profile":"'),Buffer.from([0xff]),Buffer.from('"}')]);
  fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,bytes);
  try {
    const result=install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true});
    assert.ok(result.report.some(x=>x.startsWith('Terminal settings unchanged:'))); assert.deepEqual(fs.readFileSync(target),bytes);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
