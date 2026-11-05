import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fileFor(vendor, id, env) {
  if (!['codex', 'claude'].includes(vendor) || !uuid.test(id || '')) throw new Error('invalid session identity');
  return path.join(env.AI_SETTINGS_HOME || path.join(os.homedir(), '.ai-settings'), 'state', 'session-roles', vendor, id.toLowerCase() + '.json');
}
export function readRole(vendor, id, env = process.env) {
  const file = fileFor(vendor, id, env);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  if (!data || data.vendor !== vendor || data.id !== id.toLowerCase() || !['plan', 'work', 'review'].includes(data.role)) throw new Error('invalid role record');
  return data.role;
}
export function saveRole(vendor, id, role, env = process.env) {
  const file = fileFor(vendor, id, env);
  if (!['plan', 'work', 'review'].includes(role)) throw new Error('invalid role');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify({ vendor, id: id.toLowerCase(), role }), { flag: 'wx' });
    try { fs.linkSync(temp, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (readRole(vendor, id, env) !== role) throw new Error('conflicting role');
  } finally { try { fs.unlinkSync(temp); } catch {} }
  return role;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const [action, vendor, id, role] = process.argv.slice(2);
    const result = action === 'save' ? saveRole(vendor, id, role) : action === 'read' ? readRole(vendor, id) : (() => { throw new Error('invalid action'); })();
    console.log(result || '');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
