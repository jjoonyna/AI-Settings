import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { install } from '../scripts/install-runtime.mjs';
import { mergeToml, tomlValues } from '../scripts/config-merge.mjs';

test('legacy Windows sandbox ownership survives update and uninstall without overriding user changes', async () => {
  for (const scenario of [
    { original: undefined, expected: undefined },
    { original: '"unelevated"', expected: '"unelevated"' },
    { original: '"unelevated"', beforeUpdate: '"custom-before"', expected: '"custom-before"' },
    { original: '"unelevated"', afterUpdate: '"custom-after"', expected: '"custom-after"' },
  ]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-sandbox-'));
    try {
      const home = path.join(temp, 'home'), nvim = path.join(temp, 'nvim'), config = path.join(home, '.codex', 'config.toml');
      fs.mkdirSync(path.dirname(config), { recursive: true });
      fs.writeFileSync(config, scenario.original ? `[windows]\nsandbox = ${scenario.original}\n` : '');
      const options = { home, nvim, mode: 'codex', skipTools: true };
      install(options);
      const manifestPath = path.join(home, '.ai-settings', 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.configs[config].managed['windows.sandbox'] = '"elevated"';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      fs.writeFileSync(config, mergeToml(fs.readFileSync(config, 'utf8'), { 'windows.sandbox': scenario.beforeUpdate || '"elevated"' }));
      install(options);
      assert.equal(tomlValues(fs.readFileSync(config, 'utf8'))['windows.sandbox'], scenario.beforeUpdate || '"elevated"');
      if (scenario.afterUpdate) fs.writeFileSync(config, mergeToml(fs.readFileSync(config, 'utf8'), { 'windows.sandbox': scenario.afterUpdate }));
      const { uninstall } = await import(pathToFileURL(path.join(home, '.ai-settings', 'bin', 'uninstall.mjs')).href);
      uninstall(home);
      assert.equal(tomlValues(fs.readFileSync(config, 'utf8'))['windows.sandbox'], scenario.expected);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
});

test('install and reinstall manage unsandboxed roles and preserve personal settings', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-defaults-'));
  try {
    const home = path.join(temp, 'home'), nvim = path.join(temp, 'nvim'), codex = path.join(home, '.codex');
    fs.mkdirSync(codex, { recursive: true });
    const config = path.join(codex, 'config.toml');
    fs.writeFileSync(config, 'approval_policy = "never"\napprovals_reviewer = "user"\ndefault_permissions = "plan-docs"\n[mcp_servers.mine]\ncommand = "keep"\n[profiles.plan]\napproval_policy = "never"\napprovals_reviewer = "user"\nsandbox_mode = "read-only"\ndefault_permissions = "plan-docs"\nother = "keep"\n');
    for (const role of ['plan', 'work', 'review']) fs.writeFileSync(path.join(codex, role + '.config.toml'), 'approval_policy = "never"\napprovals_reviewer = "user"\n[custom]\nvalue = "keep"\n');
    fs.writeFileSync(path.join(codex, 'plan.config.toml'), '".agent-shared.md" = "write"\n[custom]\nvalue = "keep"\n');
    const options = { home, nvim, mode: 'codex', skipTools: true };
    function check() {
      const base = tomlValues(fs.readFileSync(config, 'utf8'));
      assert.equal(base.sandbox_mode, '"danger-full-access"'); assert.equal(base.default_permissions, undefined); assert.equal(base.approval_policy, '"on-request"'); assert.equal(base.approvals_reviewer, '"auto_review"'); assert.equal(base['mcp_servers.mine.command'], '"keep"'); assert.equal(base['profiles.plan.approval_policy'], undefined); assert.equal(base['profiles.plan.approvals_reviewer'], undefined); assert.equal(base['profiles.plan.sandbox_mode'], undefined); assert.equal(base['profiles.plan.default_permissions'], undefined); assert.equal(base['profiles.plan.other'], '"keep"');
      for (const role of ['plan', 'work', 'review']) {
        const values = tomlValues(fs.readFileSync(path.join(codex, role + '.config.toml'), 'utf8'));
        assert.equal(values.approval_policy, role === 'review' ? '"never"' : undefined); assert.equal(values.approvals_reviewer, undefined); assert.equal(values['custom.value'], '"keep"');
        assert.equal(values.default_permissions, undefined); assert.equal(values.sandbox_mode, '"danger-full-access"');
        if (role === 'plan') assert.equal(values['".agent-shared.md"'], undefined);
      }
    }
    install(options); check();
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace('sandbox = "elevated"', 'sandbox = "unelevated"'));
    fs.appendFileSync(config, '\n[personal]\nvalue = "later"\n');
    fs.appendFileSync(path.join(codex, 'work.config.toml'), '\napproval_policy = "never"\n');
    // Append as a top-level key instead of under the final table.
    let work = fs.readFileSync(path.join(codex, 'work.config.toml'), 'utf8').replace('\napproval_policy = "never"\n', '\n');
    fs.writeFileSync(path.join(codex, 'work.config.toml'), 'approval_policy = "never"\n' + work);
    install(options); check(); assert.equal(tomlValues(fs.readFileSync(config, 'utf8'))['personal.value'], '"later"');
    const stable = fs.readFileSync(config, 'utf8');
    install(options); assert.equal(fs.readFileSync(config, 'utf8'), stable);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('fresh installation sets unsandboxed policy for all roles', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-sandbox-'));
  try {
    const home = path.join(temp, 'home');
    install({ home, nvim: path.join(temp, 'nvim'), mode: 'codex', skipTools: true });
    const base = tomlValues(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'));
    assert.equal(base.sandbox_mode, '"danger-full-access"');
    assert.equal(base['windows.sandbox'], undefined);
    for (const role of ['plan', 'work', 'review', 'research', 'build', 'deep-review', 'plan-fallback']) {
      const values = tomlValues(fs.readFileSync(path.join(home, '.codex', role + '.config.toml'), 'utf8'));
      assert.equal(values.sandbox_mode, '"danger-full-access"');
      assert.equal(values.approval_policy, ['review', 'deep-review'].includes(role) ? '"never"' : undefined);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test('quoted and dotted TOML paths normalize without merging literal dots or array tables', () => {
  const input = `"profiles" . 'work' . "approval_policy" = "never"
[profiles."plan"]
"approval_policy" = "never"
'approvals_reviewer' = "user"
["profiles" . 'review']
"approval_\u0070olicy" = "never"
["profiles.plan"]
approval_policy = "keep literal dot"
[[profiles.plan.list]]
approval_policy = "keep array"
`;
  const managed = { 'profiles.plan.approval_policy': null, 'profiles.plan.approvals_reviewer': null,
    'profiles.work.approval_policy': null, 'profiles.review.approval_policy': null };
  const output = mergeToml(input, managed), values = tomlValues(output);
  assert.equal(values['profiles.plan.approval_policy'], undefined);
  assert.equal(values['profiles.work.approval_policy'], undefined);
  assert.equal(values['profiles.review.approval_policy'], undefined);
  assert.equal(values['"profiles.plan".approval_policy'], '"keep literal dot"');
  assert.match(output, /approval_policy = "keep array"/);
  assert.equal(mergeToml(output, managed), output);
  assert.throws(() => mergeToml('profiles = { plan = { approval_policy = "never" } }\n', managed), /overlaps managed/);
  const added = mergeToml('[profiles."plan"]\nother = true\n', { 'profiles.plan.approval_policy': '"on-request"' });
  assert.equal((added.match(/^\[profiles/gm) || []).length, 1);
  assert.equal(tomlValues(added)['profiles.plan.approval_policy'], '"on-request"');
});

test('quoted managed paths are removed on fresh install and reinstall', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'quoted-approval-'));
  try {
    const home = path.join(temp, 'home'), nvim = path.join(temp, 'nvim'), codex = path.join(home, '.codex'), config = path.join(codex, 'config.toml');
    fs.mkdirSync(codex, { recursive: true });
    const input = `[profiles."plan"]\n"approval_policy" = "never"\n["profiles" . 'work']\napprovals_reviewer = "user"\n[profiles . "rev\\u0069ew"]\n'approval_policy' = "never"\n["profiles.plan"]\napproval_policy = "keep"\n`;
    fs.writeFileSync(config, input);
    const opts = { home, nvim, mode: 'codex', skipTools: true };
    for (let i = 0; i < 2; i++) {
      if (i) fs.writeFileSync(config, input);
      install(opts);
      const output = fs.readFileSync(config, 'utf8'), values = tomlValues(output);
      for (const role of ['plan', 'work', 'review']) {
        assert.equal(values[`profiles.${role}.approval_policy`], undefined);
        assert.equal(values[`profiles.${role}.approvals_reviewer`], undefined);
      }
      assert.equal(values['"profiles.plan".approval_policy'], '"keep"');
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('ambiguous managed inline tables fail before installation writes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-approval-'));
  try {
    const home = path.join(temp, 'home'), nvim = path.join(temp, 'nvim'), config = path.join(home, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(config), { recursive: true });
    const original = 'profiles = { plan = { approval_policy = "never" } }\n'; fs.writeFileSync(config, original);
    assert.throws(() => install({ home, nvim, mode: 'codex', skipTools: true }), /overlaps managed/);
    assert.equal(fs.readFileSync(config, 'utf8'), original);
    assert.equal(fs.existsSync(nvim), false); assert.equal(fs.existsSync(path.join(home, '.ai-settings')), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
