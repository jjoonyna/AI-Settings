import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const key = value => typeof value === 'string' && value.toLowerCase().split('+').sort().join('+') === 'ctrl+shift+w';
export function terminalPath(home) {
  const local = path.resolve(home) === path.resolve(os.homedir()) ? (process.env.LOCALAPPDATA || path.join(home, 'AppData/Local')) : path.join(home, 'AppData/Local');
  return path.join(local, 'Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json');
}
export function safeTerminal(target, home) {
  if (path.resolve(target) !== path.resolve(terminalPath(home))) throw new Error('Unsafe Terminal settings path');
  for (let p = target; ; p = path.dirname(p)) {
    try { const stat = fs.lstatSync(p); if (stat.isSymbolicLink() || (p === target && stat.nlink > 1)) throw new Error('Linked Terminal settings path'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (path.dirname(p) === p) break;
  }
}
export function readTerminal(target) {
  const bytes = fs.readFileSync(target), text = bytes.toString('utf8');
  if (!bytes.equals(Buffer.from(text, 'utf8'))) throw Error('Terminal settings are not valid UTF-8');
  return text;
}
// The displaced file is retained if it differs from what was read before editing.
export function replaceTerminal(target, home, before, after) {
  safeTerminal(target, home);
  if (process.platform !== 'win32') throw Error('Terminal replacement requires Windows');
  const suffix = crypto.randomBytes(16).toString('hex');
  const stage = path.join(path.dirname(target), '.ai-settings-terminal-' + suffix);
  const backup = path.join(path.dirname(target), '.ai-settings-terminal-backup-' + suffix);
  if (fs.existsSync(stage) || fs.existsSync(backup)) throw Error('Terminal staging path already exists');
  const script = `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$source=$env:AI_SETTINGS_TERMINAL_SOURCE
$stage=$env:AI_SETTINGS_TERMINAL_STAGE
$backup=$env:AI_SETTINGS_TERMINAL_BACKUP
$security=[IO.File]::GetAccessControl($source)
$stream=[IO.FileStream]::new([string]$stage,[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::Write,[IO.FileShare]::None,[int]4096,[IO.FileOptions]::None,$security)
try {
  # AI_SETTINGS_STAGE_OPEN
  [Console]::OpenStandardInput().CopyTo($stream)
  $stream.Flush($true)
  # AI_SETTINGS_STAGE_WRITTEN
} finally { $stream.Dispose() }
# AI_SETTINGS_BEFORE_REPLACE
$cursor=$source
while ($true) {
  if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked Terminal settings path' }
  $parent=[IO.Path]::GetDirectoryName($cursor)
  if (!$parent -or $parent -eq $cursor) { break }; $cursor=$parent
}
if (([IO.File]::GetAttributes($stage) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked Terminal staging path' }
if ((Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash -ne $env:AI_SETTINGS_TERMINAL_HASH) { throw 'Terminal staging changed' }
[IO.File]::Replace($stage,$source,$backup,$false)
# AI_SETTINGS_AFTER_REPLACE
[Console]::Out.Write('SWAPPED')
`;
  const result = childProcess.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    windowsHide: true, input: Buffer.from(after, 'utf8'), encoding: 'utf8',
    env: { ...process.env, AI_SETTINGS_TERMINAL_SOURCE: target, AI_SETTINGS_TERMINAL_STAGE: stage, AI_SETTINGS_TERMINAL_BACKUP: backup, AI_SETTINGS_TERMINAL_HASH: digest(Buffer.from(after, 'utf8')).toUpperCase() }
  });
  try {
  const exists = p => { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
  const backupExists = exists(backup), stageExists = exists(stage);
  let current; try { safeTerminal(target, home); current = readTerminal(target); } catch {}
  const swapped = result.status === 0 && result.stdout === 'SWAPPED';
  if (swapped && backupExists && current === after) {
    const stat = fs.lstatSync(backup);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) return { state: 'uncertain', warning: 'Terminal replacement completed; inspect recovery path: ' + backup };
    if (!fs.readFileSync(backup).equals(Buffer.from(before, 'utf8'))) return { state: 'conflict', warning: 'Terminal changed during replacement; user settings retained at: ' + backup };
    try { fs.unlinkSync(backup); } catch { return { state: 'uncertain', warning: 'Terminal replacement completed; retained recovery path: ' + backup }; }
    return { state: 'swapped' };
  }
  if (!swapped && !backupExists && current === before) {
    if (stageExists) {
      // The file may have been substituted after the stream closed; do not delete it.
      const error = Error('Terminal staging failed; settings unchanged; inspect staging path: ' + stage); error.safeBeforeSwap = true; throw error;
    }
    const error = Error('Terminal replacement failed; settings unchanged'); error.safeBeforeSwap = true; throw error;
  }
  const warning = backupExists ? 'Terminal replacement outcome needs inspection; recovery path: ' + backup : 'Terminal original not verified; inspect target: ' + target + '; staging path: ' + stage + '; expected backup path: ' + backup;
  return { state: 'uncertain', warning };
  } catch (error) {
    if (error.safeBeforeSwap) throw error;
    return { state: 'uncertain', warning: 'Terminal replacement outcome needs inspection; possible recovery path: ' + backup };
  }
}
// Parse JSONC into value spans; reject duplicate keys and malformed comments or JSON.
function parseJson(text) { try { return JSON.parse(text); } catch { throw Error('Invalid JSONC value'); } }
function parse(text) {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  function ws() { while (i < text.length) { if (/\s/.test(text[i])) i++; else if (text.slice(i, i + 2) === '//') { i += 2; while (i < text.length && !/[\r\n]/.test(text[i])) i++; } else if (text.slice(i, i + 2) === '/*') { const end = text.indexOf('*/', i + 2); if (end < 0) throw Error('Invalid JSONC comment'); i = end + 2; } else break; } }
  function string() { const start = i++; while (i < text.length) { if (text[i] === '\\') i += 2; else if (text[i++] === '"') return parseJson(text.slice(start, i)); } throw Error('Invalid JSONC string'); }
  function value() {
    ws(); const start = i, c = text[i];
    if (c === '{' || c === '[') {
      i++; const object = c === '{', children = [], seen = new Set(); ws();
      while (text[i] !== (object ? '}' : ']')) {
        const entry = {}; if (object) { if (text[i] !== '"') throw Error('Invalid JSONC property'); entry.start = i; entry.name = string(); if (seen.has(entry.name)) throw Error('Duplicate JSONC property'); seen.add(entry.name); ws(); if (text[i++] !== ':') throw Error('Invalid JSONC colon'); }
        entry.node = value(); entry.start ??= entry.node.start; entry.end = entry.node.end; ws();
        if (text[i] === ',') { entry.comma = i++; ws(); } else if (text[i] !== (object ? '}' : ']')) throw Error('Invalid JSONC separator');
        children.push(entry);
      }
      i++; return { start, end: i, children, object };
    }
    if (c === '"') string(); else { while (i < text.length && !/[\s,\]}\/]/.test(text[i])) i++; parseJson(text.slice(start, i)); }
    return { start, end: i };
  }
  const root = value(); ws(); if (i !== text.length || !root.object) throw Error('Invalid JSONC root'); return root;
}
const prop = (node, name) => node.children?.find(x => x.name === name)?.node;
const raw = (text, node) => text.slice(node.start, node.end);
function decoded(text, node) { return parseJson(raw(text, node)); }
function apply(text, edits) { for (const [a, b, replacement] of edits.sort((x, y) => y[0] - x[0])) text = text.slice(0, a) + replacement + text.slice(b); return text; }
function removeEntry(text, container, entry) {
  const n = container.children.indexOf(entry), edits = [[entry.start, entry.end, '']];
  if (entry.comma !== undefined) edits.push([entry.comma, entry.comma + 1, '']);
  else if (n > 0 && container.children[n - 1].comma !== undefined) {
    const comma = container.children[n - 1].comma; edits.push([comma, comma + 1, '']);
  }
  return edits;
}
function append(text, container, content) {
  const last = container.children.at(-1), edits = [[container.end - 1, container.end - 1, `\n${content}\n`]];
  if (last && last.comma === undefined) edits.push([last.end, last.end, ',']);
  return edits;
}
function bindings(text, root) {
  const found = [];
  for (const section of ['actions', 'keybindings']) {
    const array = prop(root, section); if (!array) continue;
    if (!array.children || array.object) throw Error('Unsupported Terminal bindings');
    for (const entry of array.children) {
      const object = entry.node; if (!object.object) throw Error('Unsupported Terminal binding');
      const keys = prop(object, 'keys'); if (!keys) continue;
      let value; try { value = decoded(text, keys); } catch { throw Error('Unsupported Terminal keys'); }
      const list = Array.isArray(value) ? value : [value];
      if (!list.every(x => typeof x === 'string')) throw Error('Unsupported Terminal keys');
      found.push({ section, array, entry, object, keys, value, list });
    }
  }
  return found;
}
const signature = (text, item) => digest(text.slice(item.object.start, item.keys.start) + text.slice(item.keys.end, item.object.end));
function isUnbound(text, item) {
  const id = prop(item.object, 'id');
  return item.section === 'keybindings' && item.object.children.length === 2 && id && decoded(text, id) === 'unbound' && typeof item.value === 'string' && key(item.value);
}
function validateMetadata(metadata) {
  if (!metadata || typeof metadata.owned !== 'boolean' || typeof metadata.created !== 'boolean' || !Array.isArray(metadata.originals)) throw Error('Invalid Terminal metadata');
  for (const item of metadata.originals) {
    if (!['actions', 'keybindings'].includes(item.section) || !/^[a-f0-9]{64}$/.test(item.signature) || typeof item.value !== 'string' || typeof item.installed !== 'string') throw Error('Invalid Terminal metadata');
    const value = parseJson(item.value), list = Array.isArray(value) ? value : [value];
    if (!list.every(x => typeof x === 'string') || !list.some(key) || item.installed !== JSON.stringify(list.filter(x => !key(x)))) throw Error('Invalid Terminal metadata');
  }
}
export function installTerminal(text, previous) {
  if (previous) validateMetadata(previous);
  const root = parse(text), all = bindings(text, root), matches = all.filter(x => x.list.some(key)), edits = [], originals = (previous?.originals || []).map(x => ({ ...x }));
  for (const item of matches) if (all.filter(x => x.section === item.section && signature(text, x) === signature(text, item)).length !== 1) throw Error('Ambiguous Terminal binding');
  const managed = matches.filter(x => isUnbound(text, x));
  if (managed.length > 1) throw Error('Ambiguous Terminal binding');
  for (const item of matches) {
    if (managed.includes(item)) continue;
    const sig = signature(text, item);
    const remaining = item.list.filter(x => !key(x));
    const record = { section: item.section, signature: sig, value: raw(text, item.keys), installed: JSON.stringify(remaining) };
    const index = originals.findIndex(x => x.section === item.section && x.signature === sig);
    if (index < 0) originals.push(record); else originals[index] = record;
    edits.push([item.keys.start, item.keys.end, JSON.stringify(remaining)]);
  }
  let created = previous?.created || false, owned = previous?.owned || false;
  if (!managed.length) {
    const array = prop(root, 'keybindings');
    if (array) edits.push(...append(text, array, '{"id":"unbound","keys":"ctrl+shift+w"}'));
    else { edits.push(...append(text, root, '"keybindings": [{"id":"unbound","keys":"ctrl+shift+w"}]')); created = true; }
    owned = true;
  }
  const result = apply(text, edits); parse(result); return { text: result, metadata: { originals, created, owned } };
}
export function uninstallTerminal(text, metadata) {
  validateMetadata(metadata);
  const root = parse(text), edits = [], matches = bindings(text, root).filter(x => x.list.some(key));
  if (metadata.owned) {
    const managed = matches.filter(x => isUnbound(text, x) && raw(text, x.object) === '{"id":"unbound","keys":"ctrl+shift+w"}');
    if (managed.length > 1) throw Error('Ambiguous Terminal binding');
    if (managed.length === 1) {
      const item = managed[0];
      if (metadata.created && item.array.children.length === 1 && !/\/\/|\/\*/.test(raw(text, item.array))) edits.push(...removeEntry(text, root, root.children.find(x => x.name === 'keybindings')));
      else edits.push(...removeEntry(text, item.array, item.entry));
    }
  }
  for (const original of metadata.originals || []) {
    const array = prop(root, original.section); if (!array?.children || array.object) continue;
    const candidates = array.children.map(entry => ({ entry, object: entry.node, keys: prop(entry.node, 'keys') })).filter(x => x.keys && signature(text, x) === original.signature);
    if (candidates.length > 1) throw Error('Ambiguous Terminal binding');
    if (!candidates.length) continue;
    const item = candidates[0]; let current; try { current = decoded(text, item.keys); } catch { continue; }
    if (Array.isArray(current) && raw(text, item.keys) === original.installed) edits.push([item.keys.start, item.keys.end, original.value]);
  }
  const result = apply(text, edits); parse(result); return result;
}
