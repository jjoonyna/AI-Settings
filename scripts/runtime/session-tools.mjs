import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolveConnection, invokeConnection, payloadForBinding } from './session-connection.mjs';
import { resolveSessionModel, resolveClaudeCall } from './session-model.mjs';
import { crossReviewAllowed } from './statusline.mjs';

export const MAX_MESSAGE = 256 * 1024;
export const MAX_RESPONSE = 512 * 1024;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = v => typeof v === 'string' && v.trim().length > 0 && !v.includes('\0');
const owner = v => Number.isSafeInteger(v) && v > 0;
const label = k => String(k).replace(/[\x00-\x1f\x7f]/g,'').slice(0,64);
const names = list => list.slice(0,10).map(label).join(', ');
function fields(value, allowed, required = allowed) {
  if (!object(value)) throw new Error('argument: object required');
  const unsupported = Object.keys(value).filter(k => !allowed.includes(k)), missing = required.filter(k => !Object.hasOwn(value,k));
  if (missing.length) throw new Error(`argument: missing ${names(missing)}`);
  if (unsupported.length) throw new Error(`argument: unsupported ${names(unsupported)}`);
}
const HANDOFF_REQUIRED = ['agent','session','model','name','goal','scope','validation','prompt','spec_doc','plan_doc'];
const HANDOFF_FIELDS = [...HANDOFF_REQUIRED,'decisions','references','report_to','cwd','worktree','task_id','verify_cmds'];
const HANDOFF_REQUEST = {type:'object',properties:Object.fromEntries(HANDOFF_FIELDS.map(k=>[k,k==='verify_cmds'?{type:'array',items:{type:'string'}}:{type:'string'}])),
  required:HANDOFF_REQUIRED,additionalProperties:false};
function document(root, value) {
  if (!string(value)) throw new Error('path: Markdown document required');
  try {
    const docs = fs.realpathSync(path.join(root,'docs'));
    const file = fs.realpathSync(path.resolve(root,value));
    const rel = path.relative(docs,file), rootRel = path.relative(root,docs);
    if (rootRel !== 'docs' || !rel || rel.startsWith('..') || path.isAbsolute(rel)
      || path.extname(file).toLowerCase() !== '.md' || !fs.statSync(file).isFile() || fs.statSync(file).size > MAX_MESSAGE)
      throw new Error();
    return file;
  } catch { throw new Error('path: document must be a regular Markdown file inside project docs'); }
}
const schemas = {
  connection_status: {},
  handoff: {request:HANDOFF_REQUEST},
  preview: {path:{type:'string'}},
  report: {text:{type:'string'}},
  task_complete: {owner:{type:'integer',minimum:1},task_id:{type:'string'},verified:{const:true},reviewed:{const:true}},
  session_status: {owner:{type:'integer',minimum:1},task_id:{type:'string'}},
};
const descriptions = {
  connection_status:'Verify this managed Codex/Claude/Neovim session identity, actual role and model.',
  handoff:'Plan only: start a persistent work/review child at or below the actual caller model. request uses existing handoff fields: agent, session, model, name, goal, scope, validation, prompt, spec_doc, plan_doc; optional decisions, references, report_to, cwd, worktree, task_id, verify_cmds. spec_doc and plan_doc are required: real .md files inside the current project docs. Documents must be inside current project docs.',
  preview:'Plan only: show a current-project docs Markdown file for this exact session/task. Closing is not approval.',
  report:'Work/review only: send text to the verified actual parent. Check OK; do not retry an uncertain mutation.',
  task_complete:'Plan only: confirm an exact direct child after verification and independent review; preserve approval checks.',
  session_status:'Read exact self/direct-child status and latest report. Work/review can read self only. A report or process exit is not completion.',
};
export const tools = Object.entries(schemas).map(([name,properties])=>({name,description:descriptions[name],inputSchema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}}));

const catalogContexts=new WeakMap();
function contextBytes(file,name) {
  if(!path.isAbsolute(file)||path.basename(file)!==name||fs.realpathSync(file)!==path.resolve(file))throw Error('identity: context path');
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw Error('identity: context size/type');
  const fd=fs.openSync(file,'r'),bytes=Buffer.alloc(16385);let length;
  try {const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino)throw Error('identity: context replaced');
    length=fs.readSync(fd,bytes,0,bytes.length,0);}finally{fs.closeSync(fd);}
  if(length>16384)throw Error('identity: context size');return bytes.subarray(0,length);
}
// Catalog pin is an additional binding; actual caller metadata and transcript remain mandatory.
function bootstrapMeta(env) {
  const runtime=fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
  let thread=env.AI_SETTINGS_MCP_THREAD_ID,context;
  if(env.AI_SETTINGS_MCP_CONTEXT!==undefined) {
    try {
      const file=env.AI_SETTINGS_MCP_CONTEXT;
      const bytes=contextBytes(file,'launch.bound.message.json');
      const c=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      fields(c,['kind','role','model','owner','instance','task_id','executable','resume','name','cwd','directory','runtime','socket','server','hub','cli_session','launch_sha256'],
        ['kind','role','model','owner','instance','task_id','executable','cwd','directory','runtime','socket','server','hub','cli_session','launch_sha256']);
      const original=contextBytes(path.join(path.dirname(path.resolve(file)),'launch.message.json'),'launch.message.json');
      const {cli_session,launch_sha256,...base}=c;
      if(!/^[a-f0-9]{64}$/.test(launch_sha256||'')||crypto.createHash('sha256').update(original).digest('hex')!==launch_sha256
        ||!isDeepStrictEqual(base,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original))))return {};
      if(c.kind!=='ai-settings-codex-launch'||!uuid.test(c.cli_session||'')||!owner(c.owner)||!['plan','work','review'].includes(c.role)||!string(c.model)
        ||(c.resume!==undefined&&c.resume!==c.cli_session)||(c.name!==undefined&&(!string(c.name)||Buffer.byteLength(c.name)>512||/[\x00-\x1f\x7f]/.test(c.name))))return {};
      for(const key of ['cwd','directory','runtime','hub','executable'])if(!path.isAbsolute(c[key])||fs.realpathSync(c[key])!==path.resolve(c[key]))return {};
      if(c.directory!==path.dirname(path.resolve(file))||c.runtime!==runtime||c.role!==env.AI_SETTINGS_MCP_ROLE||c.model!==env.AI_SETTINGS_MCP_MODEL
        ||c.instance!==env.AGENT_EVENT_INSTANCE||String(c.owner)!==env.AGENT_SESSION_ID
        ||c.task_id!==env.AGENT_TASK_ID||c.server!==env.NVIM||c.hub!==path.resolve(env.AGENT_HUB_HOME||'')
        ||!path.isAbsolute(c.socket)||'unix://'+c.socket.replaceAll('\\','/')!==env.AI_SETTINGS_MCP_ENDPOINT
        ||(thread!==undefined&&thread!==c.cli_session))return {};
      thread=c.cli_session;
      context={file,value:Object.freeze(c),fingerprint:crypto.createHash('sha256').update(bytes).digest('hex')};
    }catch{return {};}
  }
  for(const key of ['CODEX_THREAD_ID','CODEX_SESSION_ID'])if(env[key]!==undefined
    &&(!uuid.test(env[key])||env[key]!==thread))return {};
  if(env.AGENT_SESSION_VENDOR!=='codex'||!uuid.test(thread||'')
    ||!string(env.NVIM)||!string(env.AGENT_EVENT_INSTANCE)||!string(env.AGENT_TASK_ID)
    ||!/^[1-9]\d*$/.test(env.AGENT_SESSION_ID||'')||!path.isAbsolute(env.AGENT_HUB_HOME||'')
    ||!path.isAbsolute(env.AI_SETTINGS_HOME||'')||path.resolve(env.AI_SETTINGS_HOME)!==runtime
    ||!env.AI_SETTINGS_MCP_ENDPOINT?.startsWith('unix://')||!path.isAbsolute(env.AI_SETTINGS_MCP_ENDPOINT.slice(7)))return {};
  if(context) {
    const previous=catalogContexts.get(env);
    if(previous&&(previous.file!==context.file||previous.fingerprint!==context.fingerprint))return {};
    if(!previous)catalogContexts.set(env,Object.freeze(context));
  }
  return {_meta:{'ai-settings/session-bootstrap':{version:1,vendor:'codex',instance:env.AGENT_EVENT_INSTANCE,
    owner:Number(env.AGENT_SESSION_ID),task_id:env.AGENT_TASK_ID,cli_session:thread,
    runtime,server:env.NVIM,hub:path.resolve(env.AGENT_HUB_HOME),endpoint:env.AI_SETTINGS_MCP_ENDPOINT}}};
}

function claudeCaller(env,native=false) {
  const canonical=env.CLAUDE_CODE_SESSION_ID,legacy=env.CLAUDE_SESSION_ID;
  if(native&&canonical===undefined)throw Error('identity: canonical Claude session UUID required');
  for(const value of [canonical,legacy])if(value!==undefined&&(typeof value!=='string'||!uuid.test(value)))throw Error('identity: invalid Claude session UUID');
  if(canonical!==undefined&&legacy!==undefined&&canonical!==legacy)throw Error('identity: conflicting Claude session UUID aliases');
  const id=canonical??legacy;if(!id)throw Error('identity: Claude caller UUID required; owner inference refused');
  return id;
}
export function callTool(name, args, env=process.env, dependencies={}, requestMeta) {
  if (!Object.hasOwn(schemas,name)) throw new Error('argument: unknown tool');
  fields(args,Object.keys(schemas[name]));
  if (Buffer.byteLength(JSON.stringify(args)) > MAX_MESSAGE) throw new Error('argument: input too large');
  const vendor=env.AGENT_SESSION_VENDOR;
  if (!['codex','claude'].includes(vendor) || !string(env.NVIM) || !string(env.AGENT_EVENT_INSTANCE)
    || !/^[1-9]\d*$/.test(env.AGENT_SESSION_ID || '') || !string(env.AGENT_TASK_ID)) throw new Error('identity: managed Codex/Claude/Neovim environment required');
  if (vendor==='codex' && env.CODEX_THREAD_ID && env.CODEX_SESSION_ID && env.CODEX_THREAD_ID !== env.CODEX_SESSION_ID) throw new Error('identity: conflicting CLI IDs');
  if(vendor==='codex')for(const key of ['CODEX_THREAD_ID','CODEX_SESSION_ID'])if(env[key]!==undefined&&!uuid.test(env[key]))throw Error('identity: invalid CLI ID');
  let cli = vendor==='codex'?env.CODEX_THREAD_ID || env.CODEX_SESSION_ID:claudeCaller(env),context;
  if(vendor==='codex'&&env.AI_SETTINGS_MCP_CONTEXT!==undefined) {
    context=catalogContexts.get(env);
    if(!context||!bootstrapMeta(env)._meta)throw Error('identity: immutable catalog context required');
    if(!object(requestMeta)||!uuid.test(requestMeta.threadId||'')||(requestMeta.sessionId!==undefined&&!uuid.test(requestMeta.sessionId))
      ||(requestMeta['x-codex-turn-metadata']!==undefined&&(!object(requestMeta['x-codex-turn-metadata'])
        ||(requestMeta['x-codex-turn-metadata'].thread_id!==undefined&&requestMeta['x-codex-turn-metadata'].thread_id!==requestMeta.threadId))))
      throw Error('identity: native tools/call thread metadata required');
    for(const key of ['CODEX_THREAD_ID','CODEX_SESSION_ID'])if(env[key]!==undefined&&env[key]!==requestMeta.threadId)throw Error('identity: native caller conflicts with CLI UUID');
    if(context.value.cli_session!==requestMeta.threadId)throw Error('identity: native caller differs from catalog UUID');
    cli=requestMeta.threadId;
  } else if(vendor==='codex') {
    if(!uuid.test(cli||''))throw Error('identity: native caller UUID required; owner inference refused');
    if(requestMeta!==undefined&&(!object(requestMeta)||requestMeta.threadId!==cli))throw Error('identity: native caller metadata conflicts with legacy CLI UUID');
  }
  if (cli !== undefined && !uuid.test(cli)) throw new Error('identity: invalid CLI ID');
  const identity={instance:env.AGENT_EVENT_INSTANCE,owner:Number(env.AGENT_SESSION_ID),task_id:env.AGENT_TASK_ID,vendor,cli_session:cli};
  const binding=(dependencies.resolveConnection || resolveConnection)(identity,{server:env.NVIM,env});
  // MCP never migrates to a different terminal based on an inherited CLI ID.
  if (binding.instance !== identity.instance || binding.owner !== identity.owner || binding.task_id !== identity.task_id
    || binding.vendor !== vendor || !uuid.test(binding.cli_session || '') || (cli && cli !== binding.cli_session)
    || (vendor==='claude'&&binding.server!==env.NVIM)) throw new Error('identity: exact live binding required');
  const modelEnv={...env,...(vendor==='codex'?{CODEX_THREAD_ID:binding.cli_session,CODEX_SESSION_ID:binding.cli_session}:{CLAUDE_SESSION_ID:binding.cli_session})};
  const metadata=vendor==='claude'&&requestMeta!==undefined?resolveClaudeCall(modelEnv,name,args,requestMeta)
    :(dependencies.resolveSessionModel || resolveSessionModel)(modelEnv,undefined,undefined,false);
  if (!metadata || metadata.id !== binding.cli_session || !['plan','work','review'].includes(metadata.role) || !string(metadata.model)) throw new Error('identity: actual role/model unavailable');
  if(context&&(metadata.role!==context.value.role||metadata.model!==context.value.model))throw Error('identity: actual role/model differs from bound launch');
  const root=fs.realpathSync(dependencies.cwd || process.cwd());
  const guard={role:metadata.role,model:metadata.model,cwd:root};
  if(context)guard.transport={context:context.file,cli_session:cli,endpoint:env.AI_SETTINGS_MCP_ENDPOINT,
    runtime:context.value.runtime,hub:context.value.hub,executable:context.value.executable};
  if(vendor==='claude')guard.inbox={cli_session:cli};
  const invoke=dependencies.invokeConnection || invokeConnection;
  const execute=(action,payload)=>{
    const result=invoke(binding,action,payloadForBinding(binding,action,payload));
    const value=result.stdout;
    if (typeof value !== 'string' || Buffer.byteLength(value)>MAX_RESPONSE) throw new Error('response: invalid or too large; execution unknown; do not resend automatically');
    if (/^(FAIL:|PENDING:)/.test(value)) throw new Error(value);
    return value;
  };
  const self=JSON.parse(execute('status',{owner:binding.owner,task_id:binding.task_id,session_tools:guard}));
  if (self.id !== binding.owner || self.task_id !== binding.task_id || self.role !== metadata.role || self.model !== metadata.model)
    throw new Error('identity: live role/model mismatch');
  if (name==='connection_status') return {binding,role:metadata.role,model:metadata.model};
  if (name==='session_status') {
    if (!owner(args.owner) || !string(args.task_id)) throw new Error('argument: exact owner/task required');
    if (metadata.role!=='plan' && (args.owner!==binding.owner || args.task_id!==binding.task_id)) throw new Error('role: only plan can query a child');
    return JSON.parse(execute('status',{...args,session_tools:guard}));
  }
  if (name==='report') {
    if (metadata.role==='plan') throw new Error('role: report requires work/review');
    if (!string(args.text)) throw new Error('argument: report text required');
    return execute('report',{text:args.text,session_tools:guard});
  }
  if (metadata.role!=='plan') throw new Error('role: plan required');
  if (name==='preview') return execute('preview',{path:document(root,args.path),session_tools:guard});
  if (name==='task_complete') {
    if (!owner(args.owner) || !string(args.task_id) || args.owner===binding.owner || args.verified!==true || args.reviewed!==true) throw new Error('argument: verified/reviewed exact child required');
    execute('status',{owner:args.owner,task_id:args.task_id,session_tools:guard});
    return execute('task-complete',{...args,resolved_session:metadata,session_tools:guard});
  }
  const request=args.request;
  fields(request,HANDOFF_FIELDS,HANDOFF_REQUIRED);
  if (!['work','review'].includes(request.session)) throw new Error('role: handoff requires work/review');
  for (const [key,value] of Object.entries(request)) if(key!=='verify_cmds' && !string(value)) throw new Error(`argument: ${typeof value==='string'?'empty':'invalid'} ${label(key)}`);
  if (request.verify_cmds!==undefined && (!Array.isArray(request.verify_cmds) || request.verify_cmds.some(v=>!string(v)))) throw new Error('argument: verify_cmds must be strings');
  const catalog=JSON.parse(fs.readFileSync(path.join(env.AI_SETTINGS_HOME || path.join(os.homedir(), '.ai-settings'), 'models.json'),'utf8'));
  const parent=catalog.models.find(m=>m.id===metadata.model), selected=catalog.models.find(m=>m.id===request.model);
  let cross=false;
  if(vendor==='claude'&&request.agent==='codex'&&request.session==='review')try {
    const snapshot=JSON.parse(fs.readFileSync(path.join(env.AI_SETTINGS_HOME || path.join(os.homedir(),'.ai-settings'),'state/claude-usage.json'),'utf8'));
    cross=Number.isFinite(snapshot.observed_at)&&crossReviewAllowed(snapshot);
  }catch{}
  if (!parent || parent.vendor!==vendor || !selected || selected.vendor!==request.agent || (request.agent!==vendor&&!cross)
    || !Number.isFinite(parent.tier) || !Number.isFinite(selected.tier) || selected.tier>parent.tier) throw new Error('model: caller tier/vendor restriction');
  for (const key of ['cwd','worktree']) if(request[key]!==undefined) {
    let actual;try {actual=fs.realpathSync(path.resolve(root,request[key]));}catch {throw new Error('path: invalid worktree');}
    if(actual!==root) throw new Error('path: handoff must use current project');
  }
  return execute('handoff',{...request,cwd:root,worktree:root,spec_doc:document(root,request.spec_doc),plan_doc:document(root,request.plan_doc),
    parent_model:metadata.model,parent_agent:vendor,resolved_session:metadata,session_tools:guard});
}

export function serve(input=process.stdin,output=process.stdout,env=process.env) {
  let pending=Buffer.alloc(0),discard=false,initialized=false,ready=false;
  const send=value=>{
    const line=JSON.stringify(value);
    output.write((Buffer.byteLength(line)<=MAX_RESPONSE?line:JSON.stringify({jsonrpc:'2.0',id:value.id,error:{code:-32603,message:'Response too large; execution unknown; do not resend automatically'}}))+'\n');
  };
  const error=(id,code,message)=>send({jsonrpc:'2.0',id,error:{code,message}});
  const handle=line=>{
    let request;try{request=JSON.parse(line);}catch {error(null,-32700,'Parse error');return;}
    const id=request?.id;
    if (!object(request) || request.jsonrpc!=='2.0' || !string(request.method) || (id!==undefined && typeof id!=='string' && !(Number.isSafeInteger(id)))) {
      error(null,-32600,'Invalid Request');return;
    }
    if (id===undefined) {if(request.method==='notifications/initialized' && initialized)ready=true;return;}
    let result;
    if(request.method==='initialize') {
      if(initialized || !object(request.params) || !string(request.params.protocolVersion)) {error(id,-32602,'Invalid initialization');return;}
      const versions=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
      initialized=true;result={protocolVersion:versions.includes(request.params.protocolVersion)?request.params.protocolVersion:versions[0],capabilities:{tools:{}},serverInfo:{name:'ai-settings-sessions',version:'0.1.0'}};
    } else if(request.method==='ping') result={};
    else if(!['tools/list','tools/call'].includes(request.method)) {error(id,-32601,'Method not found');return;}
    else if(!ready) {error(id,-32600,'Initialize first');return;}
    else if(request.method==='tools/list') {
      try{fields(request.params ?? {},['_meta'],[]);if(request.params?._meta!==undefined && !object(request.params._meta))throw new Error();}catch {error(id,-32602,'Invalid params');return;}
      result={tools,...bootstrapMeta(env)};
    } else {
      try {fields(request.params,['name','arguments','_meta'],['name']);if(!string(request.params.name) || (request.params._meta!==undefined && !object(request.params._meta)))throw new Error();}
      catch {error(id,-32602,'Invalid params');return;}
      try {
        if(env.AGENT_SESSION_VENDOR==='codex'&&!object(request.params._meta))throw Error('identity: native tools/call metadata required');
        if(env.AGENT_SESSION_VENDOR==='claude') {
          claudeCaller(env,true);
          if(!object(request.params._meta))throw Error('identity: native Claude call metadata required');
        }
        const value=callTool(request.params.name,request.params.arguments===undefined?{}:request.params.arguments,env,{},request.params._meta);result={content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]};
      }
      catch(e){result={isError:true,content:[{type:'text',text:e.message}]};}
    }
    send({jsonrpc:'2.0',id,result});
  };
  // Bound buffering even for an unterminated oversized line. Calls are synchronous and never retried.
  input.on('data',chunk=>{
    let bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    while(bytes.length) {
      const end=bytes.indexOf(10),part=end<0?bytes:bytes.subarray(0,end);
      if(!discard) {
        if(pending.length+part.length>MAX_MESSAGE){pending=Buffer.alloc(0);discard=true;error(null,-32600,'Message too large');}
        else pending=Buffer.concat([pending,part]);
      }
      if(end<0)break;
      if(!discard && pending.length)handle(pending.toString('utf8'));
      pending=Buffer.alloc(0);discard=false;bytes=bytes.subarray(end+1);
    }
  });
  input.on('end',()=>{if(!discard && pending.length)handle(pending.toString('utf8'));});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))serve();
