import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { install } from '../scripts/install-runtime.mjs';
import { mergeToml, mergeJson, unmergeJson, stripManagedStopHooks } from '../scripts/config-merge.mjs';
import { usageSnapshot, crossReviewAllowed, formatStatus } from '../scripts/runtime/statusline.mjs';

test('TOML preserves MCP, multiline values, permissions and unrelated TUI settings', () => {
  const original = '# mine\nmodel = "old"\nnotify = [\n "old",\n "hook"\n]\n\n[mcp_servers.mine]\ncommand = "test"\nargs = ["a", "b"]\n\n[tui]\nscreen_reader_detection_done = true\n';
  const result = mergeToml(original, { model: '"gpt-6.1-sol"', notify: '["new"]', 'tui.status_line': '["context-used"]' });
  assert.match(result, /command = "test"/); assert.match(result, /screen_reader_detection_done = true/);
  assert.equal((result.match(/^\[tui\]$/gm) || []).length, 1);
  assert.doesNotMatch(result, /"hook"/);
  assert.equal(mergeToml(result, { model: '"gpt-6.1-sol"', notify: '["new"]', 'tui.status_line': '["context-used"]' }), result);
  assert.throws(() => mergeToml('notify = ["oops"', { model: '"x"' }));
});
test('JSON recursive ownership preserves permissions and unrelated plugin keys', () => {
  const original = { permissions: { allow: ['Bash(test)'], defaultMode: 'old' }, enabledPlugins: { mine: true } };
  const managed = { permissions: { defaultMode: 'auto' }, enabledPlugins: { ours: true } };
  const merged = mergeJson(original, managed);
  assert.deepEqual(merged.permissions.allow, original.permissions.allow);
  assert.deepEqual(unmergeJson(merged, managed, original), original);
  const groups = [{ matcher: '*', hooks: [{ command: 'ours' }, { command: 'personal/agent-done.js' }] }];
  assert.deepEqual(stripManagedStopHooks(groups, ['ours']), [{ matcher: '*', hooks: [{ command: 'personal/agent-done.js' }] }]);
});
test('usage is unknown until supplied; threshold, expiry and stale-cache checks', () => {
  const now = Date.now();
  const data = { rate_limits: { five_hour: { used_percentage: 80, resets_at: now / 1000 + 300 } } };
  const snapshot = usageSnapshot(data, now);
  assert.equal(crossReviewAllowed(snapshot, now), true);
  assert.equal(crossReviewAllowed(snapshot, now + 121000), false);
  assert.equal(crossReviewAllowed(usageSnapshot({}, now), now), false);
  assert.equal(crossReviewAllowed(usageSnapshot(data, now + 301000), now + 301000), false);
  assert.match(formatStatus({}, usageSnapshot({}, now)), /5h \?/);
  assert.doesNotMatch(formatStatus({}, usageSnapshot({}, now)), /0%/);
});
test('external design/PPT skills deploy independently with data, scripts and licenses', { skip: !process.env.AI_SETTINGS_TOOL_CACHE }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-settings-tools-'));
  try {
    const home = path.join(temp, 'home');
    const result = install({ home, nvim: path.join(temp, 'nvim'), mode: 'codex', toolCache: process.env.AI_SETTINGS_TOOL_CACHE, skipToolDependencies: true });
    for (const name of ['ppt-master', 'impeccable', 'ui-ux-pro-max', 'frontend-design']) assert.ok(fs.existsSync(path.join(home, '.codex/skills', name, 'SKILL.md')), name);
    assert.ok(fs.readdirSync(path.join(home, '.codex/skills/ui-ux-pro-max/data')).length > 0);
    assert.ok(fs.existsSync(path.join(home, '.codex/skills/impeccable/scripts/impeccable.cmd')));
    assert.ok(fs.existsSync(path.join(home, '.codex/skills/ppt-master/scripts/attribution_guard.py')));
    assert.ok(fs.existsSync(path.join(home, '.codex/skills/frontend-design/LICENSE.txt')));
    const manifest = JSON.parse(fs.readFileSync(path.join(result.root, 'manifest.json')));
    assert.equal(Object.keys(manifest.tools).length, 4);
    assert.doesNotMatch(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8'), /AI-Settings[\\/]/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('a corrupt local config rolls earlier file changes back', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-settings-rollback-'));
  try {
    const home = path.join(temp, 'home'), nvim = path.join(temp, 'nvim');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude/settings.json'), '{invalid');
    fs.mkdirSync(nvim, { recursive: true }); fs.writeFileSync(path.join(nvim, 'init.lua'), '-- original editor');
    assert.throws(() => install({ home, nvim, mode: 'both', skipTools: true }));
    assert.equal(fs.readFileSync(path.join(nvim, 'init.lua'), 'utf8'), '-- original editor');
    assert.equal(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'), '{invalid');
    assert.equal(fs.existsSync(path.join(home, '.ai-settings/manifest.json')), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('legacy folder junctions become copies without changing their source', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-settings-links-'));
  try {
    const home = path.join(temp, 'home'), nvim = path.join(temp, 'nvim'), source = path.join(temp, 'old checkout');
    fs.mkdirSync(path.join(source, 'lua/config'), { recursive: true });
    fs.writeFileSync(path.join(source, 'init.lua'), '-- linked source');
    fs.writeFileSync(path.join(source, 'lua/config/local.lua'), 'return { python = "preserved" }');
    fs.symlinkSync(source, nvim, process.platform === 'win32' ? 'junction' : 'dir');
    install({ home, nvim, mode: 'codex', skipTools: true });
    assert.equal(fs.lstatSync(nvim).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(source, 'init.lua'), 'utf8'), '-- linked source');
    assert.equal(fs.readFileSync(path.join(nvim, 'lua/config/local.lua'), 'utf8'), 'return { python = "preserved" }');
    fs.renameSync(source, source + '-moved');
    assert.ok(fs.existsSync(path.join(nvim, 'lua/config/agent/policy.lua')));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('independent install, reinstallation, personal configuration, mode switch and uninstall', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-settings-v2-'));
  const home = path.join(temp, 'home space 한글'), nvim = path.join(temp, 'editor space 한글');
  const seed = (relative, text) => { const p = path.join(home, relative); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };
  try {
    seed('.claude/.credentials.json', '{"keep":"secret"}');
    seed('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(my-command)'] }, enabledPlugins: { 'my-plugin': true }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-hook' }] }] } }));
    seed('.claude/CLAUDE.md', '# My personal rules\nKeep this.\n');
    seed('.codex/config.toml', '[mcp_servers.personal]\ncommand = "personal"\n');
    fs.mkdirSync(path.join(nvim, 'lua/config'), { recursive: true });
    fs.writeFileSync(path.join(nvim, 'lua/config/local.lua'), 'return { python = "my-python" }');
    const options = { home, nvim, mode: 'both', skipTools: true };
    const first = install(options);
    const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json')));
    assert.deepEqual(settings.permissions.allow, ['Bash(my-command)']);
    assert.equal(settings.enabledPlugins['my-plugin'], true);
    assert.equal(settings.hooks.Stop.length, 2);
    const guide = fs.readFileSync(path.join(home, '.claude/CLAUDE.md'), 'utf8');
    assert.match(guide, /Keep this/);
    assert.match(fs.readFileSync(path.join(home, '.codex/config.toml'), 'utf8'), /mcp_servers.personal/);
    assert.equal(fs.readFileSync(path.join(nvim, 'lua/config/local.lua'), 'utf8'), 'return { python = "my-python" }');
    assert.equal(fs.lstatSync(nvim).isSymbolicLink(), false);
    assert.equal(fs.existsSync(path.join(first.root, 'bin/statusline.mjs')), true);
    install(options);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'))).hooks.Stop.length, 2);
    install({ ...options, mode: 'codex' });
    const after = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json')));
    assert.deepEqual(after.permissions.allow, ['Bash(my-command)']);
    assert.equal(after.hooks.Stop[0].hooks[0].command, 'my-hook');
    assert.equal(fs.existsSync(path.join(home, '.claude/agents/implementer.md')), false);
    assert.match(fs.readFileSync(path.join(home, '.claude/CLAUDE.md'), 'utf8'), /Keep this/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(nvim, 'ai-settings.json'))).mode, 'codex');
    assert.equal(fs.readFileSync(path.join(home, '.claude/.credentials.json'), 'utf8'), '{"keep":"secret"}');
    const configPath = path.join(home, '.codex/config.toml');
    fs.appendFileSync(configPath, '\n[mcp_servers.after_install]\ncommand = "later"\n');
    const localInit = path.join(nvim, 'init.lua');
    fs.appendFileSync(localInit, '\n-- my later change\n');
    const { uninstall } = await import(pathToFileURL(path.join(home, '.ai-settings/bin/uninstall.mjs')).href);
    uninstall(home);
    assert.match(fs.readFileSync(configPath, 'utf8'), /mcp_servers.after_install/);
    assert.match(fs.readFileSync(localInit, 'utf8'), /my later change/);
    assert.equal(fs.readFileSync(path.join(nvim, 'lua/config/local.lua'), 'utf8'), 'return { python = "my-python" }');
    assert.equal(fs.readFileSync(path.join(home, '.claude/.credentials.json'), 'utf8'), '{"keep":"secret"}');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
