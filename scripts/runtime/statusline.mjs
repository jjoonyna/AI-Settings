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
export function formatStatus(data, snapshot) {
  const model = data.model?.display_name || data.model?.id || 'model ?';
  const effort = data.effort?.level ? ' · ' + data.effort.level : '';
  const ctx = data.context_window?.used_percentage;
  const items = [model + effort, `Ctx ${typeof ctx === 'number' ? Math.round(ctx) + '% used' : '?'}`];
  for (const [name, label] of [['five_hour', '5h'], ['seven_day', '7d']]) {
    const value = snapshot.windows[name];
    items.push(value ? `${label} ${value.used_percentage >= 80 ? '\x1b[33m' : ''}${Math.round(value.used_percentage)}% used${value.used_percentage >= 80 ? '\x1b[0m' : ''}` : `${label} ?`);
  }
  return items.join(' | ');
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
  } catch { console.log('model ? | Ctx ? | 5h ? | 7d ?'); }
}
