import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {childEnvironment} from './session-message-rpc.mjs';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const text = value => typeof value === 'string' && value.length > 0;
const owner = value => Number.isSafeInteger(value) && value > 0;
const cli = value => ['codex', 'claude'].includes(value.vendor) && uuid.test(value.cli_session || '');
const valid = b => b && text(b.server) && text(b.instance) && owner(b.owner) && text(b.task_id)
  && (b.cli_session === undefined || cli(b));
const clean = b => Object.fromEntries(['server','instance','owner','task_id','vendor','cli_session','parent_id'].filter(k => b[k] !== undefined).map(k => [k,b[k]]));
export function payloadForBinding(binding, action, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('identity: payload must be an object');
  const p = {...input};
  const set = (key,value) => {
    if (Object.hasOwn(p,key) && p[key] !== value) throw new Error(`identity: explicit ${key} mismatch`);
    p[key]=value;
  };
  if(action==='handoff') {set('parent_id',binding.owner);set('parent_server',binding.server);}
  if(action==='preview') {
    set('owner',binding.owner);set('task_id',binding.task_id);
    if(p.session!==undefined && Number(p.session)!==binding.owner) throw new Error('identity: explicit session mismatch');
  }
  if(action==='task-complete') set('parent_id',binding.owner);
  if(action==='report') {
    if(!owner(binding.parent_id)) throw new Error('identity: verified parent unavailable');
    set('owner',binding.owner);set('task_id',binding.task_id);set('parent_id',binding.parent_id);
  }
  return p;
}

export function classifyResult(result) {
  const code = result.error?.code;
  const detail = String(result.stderr || '');
  if (['EPERM','EACCES'].includes(code) || /EPERM|EACCES|permission denied|access.*denied/i.test(detail)) return 'permission';
  if (code === 'ETIMEDOUT' || result.signal) return 'timeout';
  if (code) return 'spawn';
  if (/ENOENT|ECONNREFUSED|no such file|connection refused/i.test(detail)) return 'unavailable';
  return 'protocol';
}

export const RPC_TIMEOUT=15000, HANDOFF_TIMEOUT=60000;
export const rpcTimeout = action => action==='handoff' ? HANDOFF_TIMEOUT : RPC_TIMEOUT;
function rpc(server, phase, payload, timeout=RPC_TIMEOUT) {
  return spawnSync('nvim', ['--headless','-u','NONE','-i','NONE','-l',
    fileURLToPath(new URL('./session-connection-rpc.lua', import.meta.url)), server, phase],
  {input: JSON.stringify(payload), encoding:'utf8', env:childEnvironment(process.env), windowsHide:true, timeout});
}
function probeServer(server, identity) {
  const result = rpc(server, 'resolve', identity);
  if (result.error || result.signal || result.status !== 0) return {ok:false,code:classifyResult(result)};
  try { return JSON.parse(result.stdout); } catch { return {ok:false,code:'protocol'}; }
}
function registry(env) {
  const root = env.AGENT_HUB_HOME || path.join(env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'), 'nvim-data','agent-hub');
  const dir = path.join(root,'instances');
  let names;
  try { names = fs.readdirSync(dir); } catch(error) { if(error.code === 'ENOENT') return []; throw new Error('permission: registry unavailable'); }
  return names.filter(n => n.endsWith('.json')).flatMap(n => {
    try { return [JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'))]; } catch { return []; }
  });
}
export function registryValid(item, now = Date.now(), kill = process.kill) {
  if (!item || item.version !== 1 || !text(item.instance) || !text(item.server) || !owner(item.pid)
    || !Number.isFinite(item.updated) || now/1000-item.updated > 30 || item.updated-now/1000 > 10 || !Array.isArray(item.entries)) return false;
  try { kill(item.pid,0); } catch(error) { if(error.code === 'ESRCH') return false; if(!['EPERM','EACCES'].includes(error.code)) return false; }
  return true;
}
export function resolveConnection(identity, {server, env=process.env, now=Date.now(), readRegistry=()=>registry(env), probe=probeServer, alive} = {}) {
  if (!text(identity?.instance) || !owner(identity.owner) || !text(identity.task_id)
    || (identity.cli_session !== undefined && !cli(identity))) throw new Error('identity: exact instance/owner/task required');
  const matches = b => valid(b) && (!identity.cli_session || (b.cli_session===identity.cli_session && b.vendor===identity.vendor))
    && ((b.instance===identity.instance && b.owner===identity.owner && b.task_id===identity.task_id) || (cli(identity) && b.instance!==identity.instance && cli(b)));
  if (server) {
    const direct = probe(server,identity);
    if (direct?.ok && matches(direct.binding) && direct.binding.server===server) return clean(direct.binding);
    if (!direct?.ok && !['unavailable','identity'].includes(direct?.code)) throw new Error(`${direct?.code || 'protocol'}: connection verification failed; update/restart Neovim if unsupported`);
  }
  const found = [];
  const seen = new Set();
  for (const item of readRegistry()) {
    if (!registryValid(item,now,alive) || seen.has(item.server)) continue;
    seen.add(item.server);
    if (item.instance!==identity.instance && !cli(identity)) continue;
    const query = item.instance===identity.instance ? identity : {vendor:identity.vendor,cli_session:identity.cli_session};
    const response = probe(item.server,query);
    if (response?.code === 'permission') throw new Error('permission: candidate access denied');
    if (response?.code === 'ambiguous') throw new Error('ambiguous: multiple sessions');
    if (response?.ok && matches(response.binding) && response.binding.server===item.server && response.binding.instance===item.instance) found.push(clean(response.binding));
  }
  if (found.length!==1) throw new Error(found.length ? 'ambiguous: multiple candidates' : 'identity: no verified candidate');
  return found[0];
}
export function invokeConnection(binding, action, payload, {run=(b,a,p)=>rpc(b.server,'invoke',{binding:b,action:a,payload:p},rpcTimeout(a))} = {}) {
  if (!valid(binding) || !['handoff','preview','report','task-complete','activity','status'].includes(action)) throw new Error('identity: invalid invocation');
  const result = run(binding,action,payload);
  if (result.error || result.signal || result.status !== 0) throw new Error(`${classifyResult(result)}: execution unknown (실행 여부 불명); do not resend automatically`);
  let response;
  try { response=JSON.parse(result.stdout); } catch { throw new Error('protocol: execution unknown; do not resend automatically'); }
  if (!response.ok) throw new Error(`${response.code || 'protocol'}: invocation failed`);
  return {...result,stdout:response.result,stderr:''};
}
