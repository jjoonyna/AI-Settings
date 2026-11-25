import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {codexRecipe,inspectCodex} from '../scripts/runtime/session-codex.mjs';
import {callTool} from '../scripts/runtime/session-tools.mjs';
const id='11111111-1111-4111-8111-111111111111';
function fixture() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'remote-binding-')),hub=path.join(directory,'hub');fs.mkdirSync(hub);
  const o={kind:'ai-settings-codex-launch',role:'work',model:'gpt-6.1-sol',cwd:directory,executable:process.execPath,directory,runtime:fs.realpathSync('scripts'),
    socket:path.join(directory,'private/c.sock'),instance:'remote-test',owner:4,task_id:'task',server:'synthetic-nvim',hub,name:'work | remote',cli_session:id};
  const file=path.join(directory,'launch.bound.message.json'),original=path.join(directory,'launch.message.json');
  const {cli_session,...base}=o;const raw=JSON.stringify(base);fs.writeFileSync(original,raw);
  fs.writeFileSync(file,JSON.stringify({...o,launch_sha256:crypto.createHash('sha256').update(raw).digest('hex')}));
  const env={...process.env,NVIM:o.server,AI_SETTINGS_HOME:o.runtime,AGENT_HUB_HOME:hub,AGENT_EVENT_INSTANCE:o.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:o.task_id,AGENT_SESSION_VENDOR:'codex',
    AI_SETTINGS_MCP_CONTEXT:file,AI_SETTINGS_MCP_ROLE:o.role,AI_SETTINGS_MCP_MODEL:o.model,AI_SETTINGS_MCP_ENDPOINT:'unix://'+o.socket.replaceAll('\\','/')};
  for(const k of ['CODEX_THREAD_ID','CODEX_SESSION_ID','AI_SETTINGS_MCP_THREAD_ID'])delete env[k];
  return {o,file,original,env,clean:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
function catalog(env,remoteArgs=[]) {
  // Fixed synthetic remote policy reproduces native rejection; actual catalog is the product MCP process.
  const runner="if(process.argv.slice(1).some(a=>a==='-c'||a==='--config'))process.exit(1);import('./scripts/runtime/session-tools.mjs').then(m=>m.serve())";
  const input=[{id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},{method:'notifications/initialized'},{id:2,method:'tools/list'}]
    .map(m=>JSON.stringify({jsonrpc:'2.0',...m})).join('\n')+'\n';
  const r=spawnSync(process.execPath,['--input-type=module','-e',runner,'--',...remoteArgs],{env,input,encoding:'utf8'});
  return {code:r.status,catalog:r.status===0?JSON.parse(r.stdout.trim().split('\n').at(-1)).result:null};
}
test('remote rejects local overrides; no-override TUI reconstructs actual catalog from fixed manifest without native env IDs',()=>{
  const f=fixture();try {
    assert.equal(catalog(f.env,['-c','model="wrong"']).code,1);
    const recipe=codexRecipe(f.o,f.env),args=recipe.tuiArgs(id);
    const r=catalog(f.env,args.slice(1));assert.equal(r.code,0,'native remote must reject no product args');
    assert.equal(r.catalog.tools.length,6);assert.equal(r.catalog._meta['ai-settings/session-bootstrap'].cli_session,id);
    assert.equal(r.catalog._meta['ai-settings/session-bootstrap'].owner,f.o.owner);
    assert(!args.includes('-c'));assert(!args.includes('--config'));
    assert.equal(recipe.request.config['mcp_servers.ai_settings_sessions'].env.AI_SETTINGS_MCP_CONTEXT,f.file);
  }finally{f.clean();}
});
test('context catalog fails closed for unbound, conflicting, malformed, oversized or replaced identity; public six stay exact',()=>{
  for(const mutate of [c=>delete c.cli_session,c=>c.cli_session='invalid',c=>c.resume='22222222-2222-4222-8222-222222222222',
    c=>c.owner=5,c=>c.instance='other',c=>c.task_id='other',c=>c.server='other',c=>c.hub=path.dirname(c.hub),c=>c.runtime=c.cwd,
    c=>c.directory=path.dirname(c.directory),c=>c.socket+='other',c=>c.kind='other',c=>c.role='review',c=>c.model='wrong',c=>c.token='forbidden',c=>c.body='forbidden',c=>c.extra='x'.repeat(17000)]) {
    const f=fixture();try{const c=structuredClone(f.o);mutate(c);fs.writeFileSync(f.file,JSON.stringify(c));const r=catalog(f.env);assert.equal(r.code,0);assert.equal(r.catalog._meta,undefined);assert.equal(r.catalog.tools.length,6);}finally{f.clean();}
  }
  for(const key of ['CODEX_THREAD_ID','CODEX_SESSION_ID'])for(const value of ['bad','22222222-2222-4222-8222-222222222222']) {
    const f=fixture();try{assert.equal(catalog({...f.env,[key]:value}).catalog._meta,undefined);}finally{f.clean();}
  }
  const f=fixture();try{const renamed=path.join(f.o.directory,'other.json');fs.renameSync(f.file,renamed);assert.equal(catalog({...f.env,AI_SETTINGS_MCP_CONTEXT:renamed}).catalog._meta,undefined);}finally{f.clean();}
});
test('catalog context grants no public call authorization or actual transcript role/model fallback',()=>{
  const f=fixture();try {
    assert(catalog(f.env).catalog._meta);
    assert.throws(()=>callTool('connection_status',{},f.env,{resolveConnection:()=>({instance:f.o.instance,owner:4,task_id:'task',vendor:'codex',cli_session:id}),
      resolveSessionModel:()=>undefined,invokeConnection:()=>{assert.fail('no mutation or host invocation without actual role/model');}}),/identity/);
    assert(catalog({...f.env,CODEX_THREAD_ID:id,CODEX_SESSION_ID:id}).catalog._meta);
  }finally{f.clean();}
});
test('consumed or externally changed launch binding fails without a thread mutation retry',async()=>{
  for(const changed of [false,true]){const f=fixture();try {
    const original=fs.readFileSync(f.file);if(changed){delete f.o.cli_session;fs.writeFileSync(f.original,JSON.stringify({...f.o,task_id:'other'}));}
    const recipe=codexRecipe(f.o,f.env),methods=[];let closes=0;
    const r=await inspectCodex(f.o,recipe,'--initialize',async()=>({close:async()=>{closes++;return {exit:{code:0}};},request:async method=>{methods.push(method);return {thread:{id},model:f.o.model,cwd:f.o.cwd,approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:{type:'dangerFullAccess'}};}}));
    assert.equal(r.code,1);assert.equal(r.result.mcp_verified,undefined);assert.equal(closes,1);assert.deepEqual(methods,[]);
    if(!changed)assert.deepEqual(fs.readFileSync(f.file),original);
  }finally{f.clean();}}
});
test('unknown launch fields cannot be copied into a newly published UUID context',async()=>{
  const f=fixture();try {
    delete f.o.cli_session;f.o.token='SYNTHETIC_FORBIDDEN_FIELD';fs.writeFileSync(f.original,JSON.stringify(f.o));const before=fs.readFileSync(f.original);
    let closes=0;const r=await inspectCodex(f.o,codexRecipe(f.o,f.env),'--initialize',async()=>({request:async()=>assert.fail('no native mutation with unapproved context fields'),close:async()=>{closes++;return {exit:{code:0}};}}));
    assert.equal(r.code,1);assert.equal(closes,1);assert.deepEqual(fs.readFileSync(f.original),before);assert(!JSON.stringify(r).includes('SYNTHETIC_FORBIDDEN_FIELD'));
    assert(!fs.readdirSync(f.o.directory).some(n=>n.endsWith('.tmp')));
  }finally{f.clean();}
});
test('new bootstrap disables initial MCP discovery and binds verified UUID before enabling cold discovery',async()=>{
  const f=fixture();try {
    delete f.o.cli_session;fs.writeFileSync(f.original,JSON.stringify(f.o));fs.unlinkSync(f.file);const recipe=codexRecipe(f.o,f.env);let opens=0;const events=[];
    const response=()=>({thread:{id},model:f.o.model,cwd:f.o.cwd,approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:{type:'dangerFullAccess'}});
    const open=async()=>{const bound=opens++>0;return {close:async()=>{events.push('close');return {exit:{code:0}};},request:async(method,p)=>{
      events.push(method);
      if(method==='thread/start'){assert.equal(p.config['mcp_servers.ai_settings_sessions'].enabled,false,'no early unbound tools/list or wait');return response();}
      if(method==='thread/name/set')return {};
      if(method==='thread/resume'){assert(bound);assert.equal(p.config['mcp_servers.ai_settings_sessions'].enabled,true);assert.equal(JSON.parse(fs.readFileSync(f.file)).cli_session,id);return response();}
      assert.equal(method,'mcpServerStatus/list');const c=catalog(f.env).catalog;
      return {data:[{name:'ai_settings_sessions',runtimeStatus:'connected',authStatus:'unsupported',toolsError:null,serverInfo:{name:'ai-settings-sessions',version:'0.1.0'},serverCapabilities:{tools:{}},
        resources:[],resourceTemplates:[],tools:Object.fromEntries(c.tools.map(t=>[t.name,t])),toolListMeta:c._meta}],nextCursor:null};
    }};};
    const r=await inspectCodex(f.o,recipe,'--initialize',open);assert.equal(r.code,0);assert.equal(r.result.mcp_verified,true);
    assert.deepEqual(events,['thread/start','thread/name/set','close','thread/resume','mcpServerStatus/list','close']);
  }finally{f.clean();}
});
