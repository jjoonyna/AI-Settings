import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
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

// Native MCP only: the host-added tool-use ID selects this call, never the last saved model.
export function resolveClaudeCall(env,name,args,meta) {
  const id=env.CLAUDE_SESSION_ID,toolId=meta?.['claudecode/toolUseId'];
  const refuse=()=>{throw new Error('identity: current Claude call model unavailable');};
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id||'')||typeof toolId!=='string'||!toolId.length
    ||Buffer.byteLength(toolId)>512||/[\x00-\x1f\x7f]/.test(toolId))refuse();
  const deadline=performance.now()+2000,chunkBytes=64*1024,recordCap=16*1024*1024;
  try {
    const root=path.resolve(env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'projects');
    if(fs.realpathSync(root)!==root)refuse();
    // Transcripts live at projects/<project>/<id>.jsonl; session subfolders (subagents, tool-results) are never scanned.
    const matches=[];let entries=0;
    const handle=fs.opendirSync(root);
    try {let entry;while((entry=handle.readSync())) {
      if(++entries>16384||performance.now()>=deadline)refuse();
      if(!entry.isDirectory())continue;
      const file=path.join(root,entry.name,id+'.jsonl');let stat;
      try{stat=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')continue;refuse();}
      if(!stat.isFile())refuse();
      matches.push(file);
    }} finally {handle.closeSync();}
    if(matches.length!==1)refuse();
    const file=matches[0],pause=new Int32Array(new SharedArrayBuffer(4));let previous,identity;
    for(;;) {
      if(performance.now()>=deadline)refuse();
      const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(file)!==file)refuse();
      if(identity&&(identity.dev!==stat.dev||identity.ino!==stat.ino))refuse();
      if(previous&&stat.size<previous.size)refuse();
      identity??={dev:stat.dev,ino:stat.ino};
      const fd=fs.openSync(file,'r'),chunk=Buffer.alloc(chunkBytes),fullHash=createHash('sha256'),prefixHash=createHash('sha256');
      let stable=false,position=0,parts=[],recordBytes=0,partial=false,found=0,model;
      const checkDeadline=()=>{if(performance.now()>=deadline)refuse();};
      function append(part) {
        if(recordBytes+part.length>recordCap)refuse();
        if(part.length){parts.push(Buffer.from(part));recordBytes+=part.length;}
      }
      function consume(atEnd=false) {
        if(!recordBytes)return;
        checkDeadline();
        const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts,recordBytes));parts=[];recordBytes=0;
        let r;try{r=JSON.parse(text);}catch{if(atEnd){partial=true;return;}refuse();}
        checkDeadline();
        if(!r||typeof r!=='object'||Array.isArray(r)||(Object.hasOwn(r,'sessionId')&&r.sessionId!==id))refuse();
        if(r.type==='assistant'&&r.sessionId===id&&Array.isArray(r.message?.content))for(const b of r.message.content) {
          checkDeadline();
          if(b?.type==='tool_use'&&b.id===toolId) {
            if(++found>1)refuse();
            model=/^(?:claude-)?(opus|sonnet|haiku|fable)(?:-|$)/.exec(r.message.model||'')?.[1];
            if(!model||b.name!=='mcp__ai_settings_sessions__'+name||!isDeepStrictEqual(b.input,args))refuse();
          }
        }
      }
      try {
        const opened=fs.fstatSync(fd);if(opened.dev!==stat.dev||opened.ino!==stat.ino)refuse();
        while(position<stat.size) {
          checkDeadline();
          const length=fs.readSync(fd,chunk,0,Math.min(chunkBytes,stat.size-position),position);if(!length)refuse();
          const bytes=chunk.subarray(0,length);fullHash.update(bytes);
          if(previous&&position<previous.size)prefixHash.update(bytes.subarray(0,Math.min(length,previous.size-position)));
          let start=0;for(let at=bytes.indexOf(10);at>=0;at=bytes.indexOf(10,start)) {
            append(bytes.subarray(start,at));consume();start=at+1;
          }
          append(bytes.subarray(start));position+=length;
        }
        consume(true);checkDeadline();
        const end=fs.fstatSync(fd),current=fs.lstatSync(file);
        if(!current.isFile()||current.isSymbolicLink()||current.dev!==stat.dev||current.ino!==stat.ino
          ||end.dev!==stat.dev||end.ino!==stat.ino||end.size<stat.size||current.size<stat.size||fs.realpathSync(file)!==file)refuse();
        stable=end.size===stat.size&&end.mtimeMs===stat.mtimeMs&&current.size===end.size&&current.mtimeMs===end.mtimeMs;
      } finally {fs.closeSync(fd);}
      if(previous&&prefixHash.digest('hex')!==previous.digest)refuse();
      previous={size:position,digest:fullHash.digest('hex')};
      if(stable&&!partial&&found===1) {
        const role=confirmedRole('claude',id,undefined,env,false);if(!role)refuse();checkDeadline();
        return {id,model,role};
      }
      const remaining=deadline-performance.now();if(remaining<=0)refuse();
      Atomics.wait(pause,0,0,Math.min(25,remaining));
    }
  } catch {refuse();}
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
