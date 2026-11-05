import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install } from '../scripts/install-runtime.mjs';
import { mergeToml, tomlValues } from '../scripts/config-merge.mjs';

test('install and reinstall manage automatic review without weakening role sandboxes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-defaults-'));
  try {
    const home = path.join(temp, 'home'), nvim = path.join(temp, 'nvim'), codex = path.join(home, '.codex');
    fs.mkdirSync(codex, { recursive: true });
    const config = path.join(codex, 'config.toml');
    fs.writeFileSync(config, 'approval_policy = "never"\napprovals_reviewer = "user"\n[mcp_servers.mine]\ncommand = "keep"\n[profiles.plan]\napproval_policy = "never"\napprovals_reviewer = "user"\nother = "keep"\n');
    for (const role of ['plan', 'work', 'review']) fs.writeFileSync(path.join(codex, role + '.config.toml'), 'approval_policy = "never"\napprovals_reviewer = "user"\n[custom]\nvalue = "keep"\n');
    const options = { home, nvim, mode: 'codex', skipTools: true };
    function check() {
      const base = tomlValues(fs.readFileSync(config, 'utf8'));
      assert.equal(base.approval_policy, '"on-request"'); assert.equal(base.approvals_reviewer, '"auto_review"'); assert.equal(base['mcp_servers.mine.command'], '"keep"'); assert.equal(base['profiles.plan.approval_policy'], undefined); assert.equal(base['profiles.plan.approvals_reviewer'], undefined); assert.equal(base['profiles.plan.other'], '"keep"');
      for (const role of ['plan', 'work', 'review']) {
        const values = tomlValues(fs.readFileSync(path.join(codex, role + '.config.toml'), 'utf8'));
        assert.equal(values.approval_policy, role === 'review' ? '"never"' : undefined); assert.equal(values.approvals_reviewer, undefined); assert.equal(values['custom.value'], '"keep"');
        if (role === 'plan') { assert.equal(values.default_permissions, '"plan-docs"'); assert.equal(values['permissions.plan-docs.extends'], '":read-only"'); }
        else assert.equal(values.sandbox_mode, role === 'work' ? '"workspace-write"' : '"danger-full-access"');
      }
    }
    install(options); check();
    fs.appendFileSync(config, '\n[personal]\nvalue = "later"\n');
    fs.appendFileSync(path.join(codex, 'work.config.toml'), '\napproval_policy = "never"\n');
    // Append as a top-level key instead of under the final table.
    let work = fs.readFileSync(path.join(codex, 'work.config.toml'), 'utf8').replace('\napproval_policy = "never"\n', '\n');
    fs.writeFileSync(path.join(codex, 'work.config.toml'), 'approval_policy = "never"\n' + work);
    install(options); check(); assert.equal(tomlValues(fs.readFileSync(config, 'utf8'))['personal.value'], '"later"');
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
