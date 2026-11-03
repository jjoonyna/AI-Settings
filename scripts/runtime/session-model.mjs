import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function roleFromTitle(title) {
  if (typeof title !== 'string') return undefined;
  const match = /^(계획|작업|리뷰) \| /.exec(title);
  return match ? ({ 계획: 'plan', 작업: 'work', 리뷰: 'review' })[match[1]] : undefined;
}

// Only an exact session identity and matching transcript header can establish a model.
export function resolveSessionModel(env = process.env) {
  if (env.AGENT_SESSION_VENDOR === 'claude' && env.CLAUDE_SESSION_ID) {
    const id = env.CLAUDE_SESSION_ID;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const root = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
    const matches = [];
    function scan(dir) {
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(p);
        else if (entry.isFile() && entry.name === id + '.jsonl') matches.push(p);
      }
    }
    scan(root);
    if (matches.length !== 1) return undefined;
    try {
      const records = fs.readFileSync(matches[0], 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (!records.some(r => r.sessionId === id) || records.some(r => r.sessionId && r.sessionId !== id)) return undefined;
      let model;
      for (const r of records) if (r.type === 'assistant' && r.message?.model) model = r.message.model;
      let title;
      for (const r of records) if (r.type === 'custom-title' && r.sessionId === id) title = r.customTitle;
      return { model: typeof model === 'string' && model ? model : undefined, role: roleFromTitle(title) };
    } catch { return undefined; }
  }
  if (env.AGENT_SESSION_VENDOR === 'claude') return undefined;
  const id = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID;
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
  if (env.CODEX_THREAD_ID && env.CODEX_SESSION_ID && env.CODEX_THREAD_ID !== env.CODEX_SESSION_ID) return undefined;
  const root = path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  const matches = [];
  function scan(dir) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(p);
      else if (entry.isFile() && entry.name.endsWith(`${id}.jsonl`)) matches.push(p);
    }
  }
  scan(root);
  if (matches.length !== 1) return undefined;
  try {
    const lines = fs.readFileSync(matches[0], 'utf8').split('\n').filter(Boolean);
    const records = lines.map(line => JSON.parse(line));
    if (records[0]?.type !== 'session_meta' || records[0]?.payload?.id !== id) return undefined;
    let model;
    for (const record of records) if (record.type === 'turn_context') model = record.payload?.model;
    let role;
    try {
      const index = fs.readFileSync(path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'session_index.jsonl'), 'utf8');
      let title;
      for (const line of index.split('\n').filter(Boolean)) {
        const row = JSON.parse(line);
        if (row.id === id) title = row.thread_name;
      }
      role = roleFromTitle(title);
    } catch { /* Unknown role requires confirmation. */ }
    return { model: typeof model === 'string' && model ? model : undefined, role };
  } catch { return undefined; }
}
