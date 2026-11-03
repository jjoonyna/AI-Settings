import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mergeToml, tomlValues, unmergeJson, stripManagedStopHooks } from './config-merge.mjs';
const read = p => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const within = (root, target) => { const rel = path.relative(path.resolve(root), path.resolve(target)); return !rel.startsWith('..') && !path.isAbsolute(rel); };
export function uninstall(home = os.homedir()) {
  home = path.resolve(home);
  const root = path.join(home, '.ai-settings'), manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(read(manifestPath));
  if (manifest.version !== 2 || !manifest.nvim || path.resolve(manifest.nvim) === home) throw new Error('Invalid manifest');
  const roots = [root, manifest.nvim, path.join(home, '.claude'), path.join(home, '.codex')];
  const report = [];
  // Validate every path before making changes, including protection against changed parent links.
  for (const target of Object.keys(manifest.files)) {
    if (!roots.some(r => within(r, target))) throw new Error('Unsafe manifest path: ' + target);
    let cursor = path.dirname(target);
    while (roots.some(r => within(r, cursor))) {
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Linked parent changed after installation: ' + cursor);
      const next = path.dirname(cursor); if (next === cursor) break; cursor = next;
    }
  }
  for (const [target, expected] of Object.entries(manifest.files)) {
    if (!fs.existsSync(target)) continue;
    if (fs.lstatSync(target).isDirectory() || fs.lstatSync(target).isSymbolicLink()) { report.push('keep: ' + target); continue; }
    const bytes = fs.readFileSync(target);
    const original = manifest.originals[target];
    if (original && !within(path.join(root, 'originals'), original)) throw new Error('Unsafe original path');
    const config = manifest.configs?.[target];
    try {
    if (config?.type === 'json') {
      const current = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      const stops = stripManagedStopHooks(current.hooks?.Stop || [], (config.managed.hooks?.Stop || []).flatMap(g => (g.hooks || []).map(h => h.command)));
      const restored = unmergeJson(current, config.managed, config.original);
      if (stops.length) { restored.hooks ||= {}; restored.hooks.Stop = stops; }
      fs.writeFileSync(target, JSON.stringify(restored, null, 2) + '\n');
    } else if (config?.type === 'toml') {
      const values = tomlValues(bytes.toString('utf8')), previous = tomlValues(config.original), changes = {};
      for (const [key, installed] of Object.entries(config.managed)) if (values[key] === installed || (installed === null && !Object.hasOwn(values, key))) changes[key] = previous[key] ?? null;
      fs.writeFileSync(target, mergeToml(bytes.toString('utf8'), changes));
    } else if (/^(AGENTS|CLAUDE)\.md$/.test(path.basename(target)) && bytes.includes(Buffer.from('<!-- AI-Settings:begin -->'))) {
      const remaining = bytes.toString('utf8').replace(/<!-- AI-Settings:begin -->[\s\S]*?<!-- AI-Settings:end -->\s*/g, '');
      if (remaining.trim()) fs.writeFileSync(target, remaining);
      else if (original) fs.copyFileSync(original, target);
      else fs.unlinkSync(target);
    } else if (hash(bytes) === expected) {
      if (original) fs.copyFileSync(original, target); else fs.unlinkSync(target);
    } else { report.push('keep locally modified: ' + target); continue; }
    } catch (error) { report.push('keep unreadable/changed configuration: ' + target + ' (' + error.message + ')'); continue; }
    report.push('restore/remove owned: ' + target);
  }
  fs.renameSync(manifestPath, path.join(root, 'uninstalled-' + Date.now() + '.json'));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(uninstall(process.argv[2]).join('\n')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
