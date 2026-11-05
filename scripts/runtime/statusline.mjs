import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function usageSnapshot(data, now = Date.now()) {
  const windows = {};
  for (const name of ['five_hour', 'seven_day']) {
    const value = data.rate_limits?.[name];
    if (typeof value?.used_percentage === 'number' && value.used_percentage >= 0 && value.used_percentage <= 100 &&
      typeof value.resets_at === 'number' && value.resets_at * 1000 > now) {
      windows[name] = { used_percentage: value.used_percentage, resets_at: value.resets_at };
    }
  }
  return { version: 1, observed_at: Math.floor(now / 1000), session_id: data.session_id || null, windows };
}
export function crossReviewAllowed(snapshot, now = Date.now()) {
  if (!snapshot || now / 1000 - snapshot.observed_at > 120 || snapshot.observed_at > now / 1000 + 5) return false;
  return Object.values(snapshot.windows || {}).some(w => Number.isFinite(w.used_percentage) && w.used_percentage >= 80 && w.used_percentage <= 100 && w.resets_at > now / 1000);
}
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function cellWidth(text) {
  let width = 0;
  for (const { segment } of segments.segment(text.replace(/\x1b\[[0-9;]*m/g, ''))) {
    if (/^[\p{Mark}\p{Default_Ignorable_Code_Point}]+$/u.test(segment)) continue;
    const cp = segment.codePointAt(0);
    // shortcut: ambiguous-width characters use one cell; update if terminal policy changes.
    width += /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(segment) ||
      (cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
        (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe19) ||
        (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff01 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x20000 && cp <= 0x3fffd))) ? 2 : 1;
  }
  return width;
}
export function formatStatus(data, snapshot, columns = process.env.COLUMNS) {
  const model = data.model?.display_name || data.model?.id || 'model ?';
  const width = /^[1-9]\d*$/.test(columns || '') && Number.isSafeInteger(Number(columns)) ? Number(columns) : 0;
  const ctx = data.context_window?.used_percentage;
  const items = [model];
  for (const [name, label] of [['five_hour', '5h'], ['seven_day', '7d']]) {
    const value = snapshot.windows[name];
    items.push(value ? `${label} ${value.used_percentage >= 80 ? '\x1b[33m' : ''}${Math.round(value.used_percentage)}%${value.used_percentage >= 80 ? '\x1b[0m' : ''}` : `${label} ?`);
  }
  let context = `Ctx ${typeof ctx === 'number' ? Math.round(ctx) + '% used' : '?'}`;
  if (width && cellWidth(context) > width) context = context.replace(' used', '');
  if (width && cellWidth(context) > width) context = context.replace('Ctx ', 'C ');
  items.push(context);
  if (data.effort?.level) items.push(data.effort.level);
  const lines = [];
  for (let item of items) {
    if (width && cellWidth(item) > width && !item.includes('\x1b')) {
      let shortened = '';
      for (const { segment } of segments.segment(item)) {
        if (cellWidth(shortened + segment) > width) break;
        shortened += segment;
      }
      item = shortened;
    }
    const last = lines.length - 1;
    const combined = last >= 0 ? lines[last] + ' | ' + item : item;
    if (last >= 0 && (!width || cellWidth(combined) <= width)) lines[last] = combined;
    else lines.push(item);
  }
  return lines.join('\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const data = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
    const root = process.env.AI_SETTINGS_HOME || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const snapshot = usageSnapshot(data);
    try {
      const dir = path.join(root, 'state'); fs.mkdirSync(dir, { recursive: true });
      const temp = path.join(dir, `claude-usage.${process.pid}.tmp`);
      fs.writeFileSync(temp, JSON.stringify(snapshot)); fs.renameSync(temp, path.join(dir, 'claude-usage.json'));
    } catch { /* Read-only state must not break the visible status line. */ }
    console.log(formatStatus(data, snapshot));
    const cwd = data.workspace?.current_dir || data.cwd || os.homedir();
    const branch = spawnSync('git', ['--no-optional-locks', '-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true, timeout: 1000 });
    console.log(path.basename(cwd) + (branch.status === 0 && branch.stdout.trim() ? ' | ' + branch.stdout.trim() : ''));
  } catch { console.log(formatStatus({}, { windows: {} })); }
}
