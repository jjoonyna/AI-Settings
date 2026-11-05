import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveSessionModel } from './session-model.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalized = p => {
  const value = path.resolve(p).replaceAll('\\', '/').replace(/\/$/, '');
  return process.platform === 'win32' ? value.toLowerCase() : value;
};

export function listSessions(vendor, cwd, env = process.env) {
  if (!['codex', 'claude'].includes(vendor) || !cwd) return [];
  const home = vendor === 'codex' ? env.CODEX_HOME || path.join(os.homedir(), '.codex')
    : env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const root = path.join(home, vendor === 'codex' ? 'sessions' : 'projects');
  const candidates = [];
  const counts = new Map();
  function scan(dir) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const id = entry.name.slice(-42, -6);
      if (!uuid.test(id) || (vendor === 'claude' && entry.name !== id + '.jsonl')) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
      try {
        const records = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
        const valid = vendor === 'codex' ? records[0]?.type === 'session_meta' && records[0]?.payload?.id === id
          : records.some(r => r.sessionId === id) && !records.some(r => r.sessionId && r.sessionId !== id);
        const directory = vendor === 'codex' ? records[0]?.payload?.cwd : records.find(r => r.sessionId === id && r.cwd)?.cwd;
        if (!valid || typeof directory !== 'string' || normalized(directory) !== normalized(cwd)) continue;
        candidates.push({ id, records, modified: fs.statSync(file).mtimeMs });
      } catch { /* Ignore incomplete or unreadable transcripts. */ }
    }
  }
  scan(root);
  let index = '';
  if (vendor === 'codex') { try { index = fs.readFileSync(path.join(home, 'session_index.jsonl'), 'utf8'); } catch {} }
  return candidates.filter(item => counts.get(item.id) === 1).map(item => {
    const identity = vendor === 'codex' ? { CODEX_THREAD_ID: item.id, CODEX_SESSION_ID: item.id }
      : { CLAUDE_SESSION_ID: item.id };
    const metadata = resolveSessionModel({ ...env, ...identity, AGENT_SESSION_VENDOR: vendor }, undefined, { records: item.records, index });
    return metadata && { ...metadata, modified: item.modified };
  }).filter(Boolean).sort((a, b) => b.modified - a.modified);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(listSessions(process.argv[2], process.argv[3])));
}
