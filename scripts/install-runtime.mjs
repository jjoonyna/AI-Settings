import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mergeJson, mergeToml, unmergeJson, tomlValues, stripManagedStopHooks } from './config-merge.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const json = p => JSON.parse(read(p));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const present = p => { try { fs.lstatSync(p); return true; } catch { return false; } };
function within(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function write(p, data) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); }

export function install(options) {
  const home = path.resolve(options.home || os.homedir());
  const nvim = path.resolve(options.nvim || path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData/Local'), 'nvim'));
  const mode = options.mode || 'both';
  const catalog = json(path.join(repo, 'runtime/models.json'));
  if (!['both', 'codex'].includes(mode)) throw new Error('mode must be both or codex');
  if (!options.dryRun && !options.skipTools && !options.skipToolDependencies && (!options.python || !present(options.python))) throw new Error('Python 3.11+ is required for PPT/design tools. Install Python or pass -Python <python.exe>.');
  if (within(repo, nvim) || within(nvim, repo) || nvim === home || within(nvim, home)) throw new Error('Unsafe installation target');
  const root = path.join(home, '.ai-settings');
  const manifestPath = path.join(root, 'manifest.json');
  const old = present(manifestPath) ? json(manifestPath) : { files: {}, originals: {}, directories: [] };
  const legacyPath = path.join(home, '.agent-env-manifest.json');
  const legacy = present(legacyPath) ? json(legacyPath) : {};
  const roots = [root, nvim, path.join(home, '.claude'), path.join(home, '.codex')];
  const valid = p => roots.some(r => within(r, p));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  const backup = path.join(root, 'backups', stamp);
  const manifest = { version: 2, mode, nvim, installed: new Date().toISOString(), files: {}, originals: { ...old.originals }, configs: { ...old.configs }, directories: old.directories || [] };
  const undo = []; const report = [];
  // Never write through an old folder junction/symlink into the source checkout.
  function detach(target) {
    if (!present(target) || !fs.lstatSync(target).isSymbolicLink()) return;
    const saved = path.join(backup, 'links', String(undo.length));
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    const linked = fs.realpathSync(target);
    fs.renameSync(target, saved);
    undo.push(() => { fs.rmSync(target, { recursive: true, force: true }); fs.renameSync(saved, target); });
    fs.cpSync(linked, target, { recursive: true, dereference: true, filter: p => !p.split(path.sep).includes('.git') });
    report.push('link -> independent copy: ' + target);
  }
  function put(target, data) {
    if (!valid(target)) throw new Error('Target outside installation roots: ' + target);
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    manifest.files[target] = hash(bytes);
    if (!Object.hasOwn(manifest.originals, target)) {
      const original = present(target) ? path.join(root, 'originals', hash(target)) : null;
      if (original) write(original, fs.readFileSync(target));
      manifest.originals[target] = original;
    }
    if (present(target) && !fs.lstatSync(target).isSymbolicLink() && fs.readFileSync(target).equals(bytes)) return;
    const existed = present(target); const previous = existed ? fs.readFileSync(target) : null;
    const link = existed && fs.lstatSync(target).isSymbolicLink() ? fs.readlinkSync(target) : null;
    if (existed) write(path.join(backup, 'files', hash(target)), previous);
    undo.push(() => { fs.rmSync(target, { force: true }); if (link) fs.symlinkSync(link, target); else if (previous) write(target, previous); });
    if (link) fs.unlinkSync(target);
    write(target, bytes); report.push('write: ' + target);
  }
  function copyTree(source, target) {
    for (const item of fs.readdirSync(source, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(item.name)) continue;
      const nvimSource = within(path.join(repo, 'nvim'), source);
      if (nvimSource && (['.tests', 'data', 'debug', '.repro'].includes(item.name) || /\.bak|\.log$/.test(item.name))) continue;
      const from = path.join(source, item.name), to = path.join(target, item.name);
      if (item.isSymbolicLink()) throw new Error('Source link requires review: ' + from);
      if (item.isDirectory()) copyTree(from, to);
      else if (item.isFile() && (!nvimSource || !item.name.endsWith('.tmpl')) && to !== path.join(nvim, 'lua/config/local.lua')) put(to, fs.readFileSync(from));
    }
  }
  if (options.dryRun) return { mode, home, nvim, root, actions: ['copy managed files', 'merge local settings', 'install skills', 'preserve credentials/history'], dryRun: true };
  try {
    // Preserve local settings before source files are replaced.
    const localPath = path.join(nvim, 'lua/config/local.lua');
    const localLua = present(localPath) ? fs.readFileSync(localPath) : null;
    for (const folder of [nvim, path.join(home, '.claude'), path.join(home, '.codex'), path.join(home, '.claude/agents'), path.join(home, '.claude/hooks'), path.join(home, '.claude/skills/agent-init')]) detach(folder);
    copyTree(path.join(repo, 'nvim'), nvim);
    if (localLua) put(localPath, localLua);
    else {
      const lua = s => JSON.stringify(s || '').replace(/\\u([0-9a-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      put(localPath, `return { jdk21 = ${lua(options.jdk)}, python = ${lua(options.python)}, projects = { rbm = { root = ${lua(options.rbm)}, kind = "java" }, docs = { root = ${lua(options.docs)}, kind = "docs" } } }\n`);
    }
    const metadata = { version: 2, mode, runtime: root, models: path.join(root, 'models.json') };
    put(path.join(nvim, 'ai-settings.json'), JSON.stringify(metadata, null, 2));
    copyTree(path.join(repo, 'runtime'), root);
    copyTree(path.join(repo, 'scripts/runtime'), path.join(root, 'bin'));
    put(path.join(root, 'bin/config-merge.mjs'), fs.readFileSync(path.join(repo, 'scripts/config-merge.mjs')));
    put(path.join(root, 'install.json'), JSON.stringify(metadata, null, 2));
    const policy = read(path.join(repo, 'runtime/POLICY.md'));
    function instructions(target) {
      const begin = '<!-- AI-Settings:begin -->', end = '<!-- AI-Settings:end -->';
      let existing = present(target) ? read(target) : '';
      if (existing.includes(begin)) existing = existing.replace(/<!-- AI-Settings:begin -->[\s\S]*?<!-- AI-Settings:end -->\s*/g, '');
      else if (legacy[target] || old.files[target]) {
        // Preserve personal paragraphs from legacy instructions, but remove old managed policy.
        // Entire legacy text is backed up; unrecognized additions remain in a clearly local section.
        const baseline = read(path.join(repo, 'runtime/legacy-policy.md'));
        const additions = existing.split(/\r?\n/).filter(line => line.trim() && !baseline.includes(line));
        existing = additions.length ? '## 이전 로컬 지침 (공통 운영 규칙과 충돌하면 공통 규칙 우선)\n' + additions.join('\n') : '';
      }
      put(target, `${begin}\n설치 루트: \`${root}\`\n모델 목록: \`${path.join(root, 'models.json')}\`\n실행 도구: \`${path.join(root, 'bin/session.mjs')}\`\n\n${policy}\n${end}\n${existing ? '\n' + existing : ''}`);
    }
    const codexHome = path.join(home, '.codex');
    instructions(path.join(codexHome, 'AGENTS.md'));
    for (const name of fs.readdirSync(path.join(repo, 'codex')).filter(name => name.startsWith('CODEX-') && name.endsWith('.md'))) put(path.join(codexHome, name), fs.readFileSync(path.join(repo, 'codex', name)));
    for (const role of ['plan', 'work', 'review', 'research', 'build', 'deep-review', 'plan-fallback']) {
      const target = path.join(codexHome, role + '.config.toml');
      const before = present(target) ? read(target) : '';
      const managed = { ...tomlValues(read(path.join(repo, 'codex', role + '.config.toml'))), model: null, model_reasoning_effort: null,
        ...(role === 'plan' ? { sandbox_mode: null } : { default_permissions: null }) };
      manifest.configs[target] = { type: 'toml', managed, original: old.configs?.[target]?.original ?? before };
      put(target, mergeToml(before, managed));
    }
    const status = ['model-with-reasoning', 'context-used', 'five-hour-limit', 'weekly-limit', 'current-dir', 'git-branch'];
    const codexConfig = path.join(codexHome, 'config.toml');
    const managed = { model: JSON.stringify(catalog.defaults.codex), model_reasoning_effort: '"medium"', 'tui.status_line': JSON.stringify(status), 'windows.sandbox': '"unelevated"' };
    // Retain notify support for the existing completion hook; Codex-only uses its own installed hook.
    managed.notify = JSON.stringify(['node', path.join(root, 'bin/agent-done.js').replaceAll('\\', '/'), '--codex']);
    for (const project of options.trusted || []) {
      // Quoted tables are appended separately below so arbitrary path dots aren't split as config keys.
      if (project.includes("'") || /[\r\n]/.test(project)) throw new Error('Unsupported trusted path');
    }
    const beforeToml = present(codexConfig) ? read(codexConfig) : '';
    manifest.configs[codexConfig] = { type: 'toml', managed, original: old.configs?.[codexConfig]?.original ?? beforeToml };
    let toml = mergeToml(beforeToml, managed);
    for (const project of options.trusted || []) {
      const table = `projects.'${path.resolve(project).replaceAll('\\', '/')}'`;
      if (!toml.includes(`[${table}]`)) toml += `\n[${table}]\ntrust_level = "trusted"\n`;
    }
    put(codexConfig, toml);
    // Both tools receive the project-initialization and session workflow skills.
    const toolHomes = [codexHome];
    if (mode === 'both') toolHomes.push(path.join(home, '.claude'));
    for (const toolHome of toolHomes) {
      copyTree(path.join(repo, 'claude/skills/agent-init'), path.join(toolHome, 'skills/agent-init'));
      copyTree(path.join(repo, 'runtime/skills'), path.join(toolHome, 'skills'));
    }
    if (mode === 'both') {
      const claudeHome = path.join(home, '.claude');
      instructions(path.join(claudeHome, 'CLAUDE.md'));
      copyTree(path.join(repo, 'claude/agents'), path.join(claudeHome, 'agents'));
      copyTree(path.join(repo, 'claude/hooks'), path.join(claudeHome, 'hooks'));
      put(path.join(claudeHome, 'statusline-command.ps1'), fs.readFileSync(path.join(repo, 'claude/statusline-command.ps1')));
      const target = path.join(claudeHome, 'settings.json');
      const template = JSON.parse(read(path.join(repo, 'claude/settings.json.tmpl')).replaceAll('{{CLAUDE_HOME_JSON}}', claudeHome.replaceAll('\\', '\\\\')));
      const legacyStop = template.hooks.Stop[0].hooks[0].command;
      template.model = catalog.defaults.claude;
      template.hooks.Stop[0].hooks[0].command = 'node "' + path.join(root, 'bin/agent-done.js') + '"';
      const existing = present(target) ? json(target) : {};
      // Keep unrelated hook events and user Stop hooks; replace only our known hook.
      const stops = stripManagedStopHooks(existing.hooks?.Stop || [], [legacyStop, template.hooks.Stop[0].hooks[0].command]);
      const merged = mergeJson(existing, template);
      merged.hooks.Stop = [...stops, ...template.hooks.Stop];
      put(target, JSON.stringify(merged, null, 2) + '\n');
      manifest.configs[target] = { type: 'json', managed: template, original: old.configs?.[target]?.original ?? existing };
    } else {
      const target = path.join(home, '.claude/settings.json');
      const legacyTemplate = JSON.parse(read(path.join(repo, 'claude/settings.json.tmpl')).replaceAll('{{CLAUDE_HOME_JSON}}', path.join(home, '.claude').replaceAll('\\', '\\\\')));
      const config = old.configs?.[target] || (legacy[target] ? { managed: legacyTemplate, original: {} } : null);
      if (config && present(target)) {
        const current = json(target);
        // Remove only our Stop command while keeping unrelated hooks, including later additions.
        const commands = [...(config.managed.hooks?.Stop || []), ...(legacyTemplate.hooks?.Stop || [])].flatMap(g => (g.hooks || []).map(h => h.command));
        const savedStops = stripManagedStopHooks(current.hooks?.Stop || [], commands);
        const reverted = unmergeJson(current, config.managed, config.original);
        if (savedStops.length) { reverted.hooks ||= {}; reverted.hooks.Stop = savedStops; }
        put(target, JSON.stringify(reverted, null, 2) + '\n');
        delete manifest.configs[target];
      }
      const guide = path.join(home, '.claude/CLAUDE.md');
      if (present(guide) && read(guide).includes('<!-- AI-Settings:begin -->')) {
        const remainder = read(guide).replace(/<!-- AI-Settings:begin -->[\s\S]*?<!-- AI-Settings:end -->\s*/g, '').trim();
        put(guide, remainder ? remainder + '\n' : '');
      } else if (legacy[guide] && present(guide)) {
        const baseline = read(path.join(repo, 'runtime/legacy-policy.md'));
        put(guide, read(guide).split(/\r?\n/).filter(line => line.trim() && !baseline.includes(line)).join('\n'));
      }
    }
    const sources = options.skipTools ? [] : json(path.join(repo, 'runtime/tool-sources.json'));
    if (options.skipTools && old.tools) {
      manifest.tools = old.tools;
      for (const [target, digest] of Object.entries(old.files || {})) {
        if (toolHomes.some(h => Object.keys(old.tools).some(name => within(path.join(h, 'skills', name), target))) && present(target)) manifest.files[target] = digest;
      }
    }
    for (const source of sources) {
      const checkout = options.toolCache ? path.join(options.toolCache, source.cacheName || source.name) : path.join(root, 'tools', source.name);
      if (!present(checkout)) {
        if (options.toolCache) throw new Error('Missing cached tool: ' + checkout);
        fs.mkdirSync(path.dirname(checkout), { recursive: true });
        const result = spawnSync('git', ['clone', '--depth', '1', '--branch', source.ref, source.url, checkout], { stdio: 'inherit', windowsHide: true });
        if (result.status !== 0) throw new Error('Tool download failed: ' + source.name);
      }
      const gitArgs = ['-c', 'safe.directory=' + checkout.replaceAll('\\', '/'), '-C', checkout];
      let commit = spawnSync('git', [...gitArgs, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
      if (commit.status !== 0) throw new Error('Invalid tool checkout: ' + source.name);
      if (source.commit && commit.stdout.trim() !== source.commit) {
        if (options.toolCache) throw new Error('Cached tool revision mismatch: ' + source.name);
        const fetch = spawnSync('git', [...gitArgs, 'fetch', '--depth', '1', 'origin', source.commit], { stdio: 'inherit', windowsHide: true });
        const select = fetch.status === 0 && spawnSync('git', [...gitArgs, 'checkout', '--detach', source.commit], { stdio: 'inherit', windowsHide: true });
        if (!select || select.status !== 0) throw new Error('Cannot select pinned tool revision: ' + source.name);
        commit = { stdout: source.commit };
      }
      const skill = source.paths.find(p => present(path.join(checkout, p, 'SKILL.md')));
      if (!skill) throw new Error('Skill layout changed: ' + source.name);
      for (const toolHome of toolHomes) {
        const target = path.join(toolHome, 'skills', source.name);
        copyTree(path.join(checkout, skill), target);
        for (const license of ['LICENSE', 'LICENSE.txt', 'NOTICE', 'NOTICE.md']) if (present(path.join(checkout, license))) put(path.join(target, license), fs.readFileSync(path.join(checkout, license)));
      }
      manifest.tools ||= {}; manifest.tools[source.name] = { commit: commit.stdout.trim(), source: source.url };
    }
    if (!options.skipTools && !options.skipToolDependencies) {
      if (!options.python || !present(options.python)) throw new Error('Python 3.11+ is required. Install Python or pass -Python <python.exe>.');
      const venv = path.join(root, 'python');
      const executable = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      if (!present(executable)) {
        const create = spawnSync(options.python, ['-m', 'venv', venv], { stdio: 'inherit', windowsHide: true });
        if (create.status !== 0) throw new Error('Cannot create isolated tool Python environment');
      }
      const requirements = path.join(codexHome, 'skills/ppt-master/requirements.txt');
      const pip = spawnSync(executable, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements], { stdio: 'inherit', windowsHide: true });
      if (pip.status !== 0) throw new Error('PPT dependencies failed; configuration changes were rolled back.');
      metadata.python = executable;
      put(path.join(root, 'install.json'), JSON.stringify(metadata, null, 2));
      put(path.join(nvim, 'ai-settings.json'), JSON.stringify(metadata, null, 2));
    }
    // Remove only obsolete, unchanged owned files; personal edits are retained.
    for (const [target, expected] of Object.entries(old.files || {})) {
      if (Object.hasOwn(manifest.files, target) || !valid(target) || !present(target)) continue;
      if (fs.lstatSync(target).isDirectory() || hash(fs.readFileSync(target)) !== expected) { report.push('keep locally modified: ' + target); continue; }
      const bytes = fs.readFileSync(target); write(path.join(backup, 'removed', hash(target)), bytes);
      undo.push(() => write(target, bytes));
      const original = manifest.originals[target];
      if (original && present(original)) write(target, fs.readFileSync(original)); else fs.unlinkSync(target);
    }
    write(path.join(backup, 'previous-manifest.json'), JSON.stringify(old, null, 2));
    const previousManifest = present(manifestPath) ? fs.readFileSync(manifestPath) : null;
    undo.push(() => { if (previousManifest) write(manifestPath, previousManifest); else fs.rmSync(manifestPath, { force: true }); });
    write(manifestPath, JSON.stringify(manifest, null, 2));
    if (present(legacyPath)) fs.renameSync(legacyPath, path.join(backup, 'legacy-manifest.json'));
    return { mode, root, nvim, backup, report, toolsSkipped: !!options.skipTools };
  } catch (error) {
    for (const restore of undo.reverse()) { try { restore(); } catch (why) { console.error('Rollback requires attention:', why.message); } }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = JSON.parse(read(process.argv[2]));
    const result = install(options);
    if (result.report) {
      write(path.join(result.backup, 'report.json'), JSON.stringify(result.report, null, 2));
      const { report, ...summary } = result;
      console.log(JSON.stringify({ ...summary, changed: report.length, report: path.join(result.backup, 'report.json') }, null, 2));
    } else console.log(JSON.stringify(result, null, 2));
  }
  catch (error) { console.error(error.stack); process.exitCode = 1; }
}
