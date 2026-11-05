import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readRole, saveRole } from './session-role.mjs';

function roleFromTitle(title) {
  if (typeof title !== 'string') return undefined;
  const match = /^(계획|작업|리뷰) \| /.exec(title);
  return match ? ({ 계획: 'plan', 작업: 'work', 리뷰: 'review' })[match[1]] : undefined;
}

function confirmedRole(vendor, id, title, env, persist) {
  try {
    const stored = readRole(vendor, id, env);
    const legacy = roleFromTitle(title);
    return stored || (legacy ? (persist ? saveRole(vendor, id, legacy, env) : legacy) : undefined);
  } catch { return undefined; }
}

// Only an exact session identity and matching transcript header can establish a model.
export function resolveSessionModel(env = process.env, hook, verified, persist = true) {
  if (env.AGENT_SESSION_VENDOR === 'claude' && env.CLAUDE_SESSION_ID) {
    const id = env.CLAUDE_SESSION_ID;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return undefined;
    const root = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
    const sameHook = hook?.session_id === id ? hook : undefined;
    const alias = model => /^(?:claude-)?(opus|sonnet|haiku|fable)(?:-|$)/.exec(model || '')?.[1];
    const hookTitle = typeof sameHook?.session_title === 'string' ? sameHook.session_title || undefined : undefined;
    const hookModel = alias(sameHook?.model);
    const metadata = (title, model) => ({ id, title, role: confirmedRole('claude', id, title, env, persist), model });
    if (hookTitle && hookModel) return metadata(hookTitle, hookModel);
    const partial = hookTitle || hookModel ? metadata(hookTitle, hookModel) : undefined;
    const transcript = sameHook?.transcript_path;
    const matches = [];
    function scan(dir) {
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(p);
        else if (entry.isFile() && entry.name === id + '.jsonl') matches.push(p);
      }
    }
    if (verified) matches.push('verified');
    else if (typeof transcript === 'string' && path.isAbsolute(transcript) && path.basename(transcript) === id + '.jsonl'
      && fs.existsSync(transcript)) matches.push(transcript);
    else scan(root);
    if (matches.length !== 1) return partial;
    try {
      const records = verified?.records || fs.readFileSync(matches[0], 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (!records.some(r => r.sessionId === id) || records.some(r => r.sessionId && r.sessionId !== id)) return partial;
      let model;
      for (const r of records) if (r.type === 'assistant' && r.message?.model !== '<synthetic>') model = r.message?.model || model;
      let title;
      for (const r of records) if (r.type === 'custom-title' && r.sessionId === id) title = r.customTitle;
      return metadata(hookTitle || title, hookModel || alias(model));
    } catch { return partial; }
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
  if (verified) matches.push('verified'); else scan(root);
  if (matches.length !== 1) return undefined;
  try {
    const records = verified?.records || fs.readFileSync(matches[0], 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (records[0]?.type !== 'session_meta' || records[0]?.payload?.id !== id) return undefined;
    let model;
    for (const record of records) if (record.type === 'turn_context') model = record.payload?.model;
    let title;
    try {
      const index = verified?.index ?? fs.readFileSync(path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'session_index.jsonl'), 'utf8');
      for (const line of index.split('\n').filter(Boolean)) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (row.id === id) title = row.thread_name;
      }
    } catch { /* Unknown role requires confirmation. */ }
    return { model: typeof model === 'string' && model ? model : undefined, role: confirmedRole('codex', id, title, env, persist), title, id };
  } catch { return undefined; }
}
