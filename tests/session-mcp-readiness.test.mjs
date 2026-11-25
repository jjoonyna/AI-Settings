import test,{after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {initializeCodex as nativeInitialize,checkCodex,codexRecipe} from '../scripts/runtime/session-codex.mjs';
import {tools} from '../scripts/runtime/session-tools.mjs';
const id='11111111-1111-4111-8111-111111111111';
const runtime=path.resolve('scripts');
const o={role:'work',model:'gpt-6.1-sol',cwd:process.cwd(),executable:process.execPath,directory:fs.mkdtempSync(path.join(os.tmpdir(),'context-test-')),socket:path.resolve('synthetic/new-ipc/c.sock'),
  owner:4,instance:'instance',task_id:'task',runtime,server:'synthetic-nvim',hub:path.resolve('synthetic/hub')};
after(()=>fs.rmSync(o.directory,{recursive:true,force:true}));
function initializeCodex(input,...rest){for(const name of ['launch.initialize.claim','launch.bound.message.json'])fs.rmSync(path.join(input.directory,name),{force:true});fs.writeFileSync(path.join(input.directory,'launch.message.json'),JSON.stringify(input));return nativeInitialize(input,...rest);}
const env={...process.env,NVIM:o.server,AGENT_HUB_HOME:o.hub,AI_SETTINGS_HOME:runtime,AGENT_EVENT_INSTANCE:o.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:'task',AGENT_SESSION_VENDOR:'codex',
  AI_SETTINGS_MCP_THREAD_ID:id,AI_SETTINGS_MCP_ENDPOINT:'unix://'+o.socket.replaceAll('\\','/')};
delete env.CODEX_THREAD_ID;delete env.CODEX_SESSION_ID;
function configuredCatalog(e=env) {
  const input=[{id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},{method:'notifications/initialized'},
    {id:2,method:'tools/list'},{id:3,method:'tools/call',params:{name:'connection_status',arguments:{}}}].map(r=>JSON.stringify({jsonrpc:'2.0',...r})).join('\n')+'\n';
  const r=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/runtime/session-tools.mjs',import.meta.url))],{env:e,input,encoding:'utf8'});
  assert.equal(r.status,0);return r.stdout.trim().split('\n').map(JSON.parse);
}
function response(){return {thread:{id},model:o.model,cwd:o.cwd,approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:{type:'dangerFullAccess'}};}
function status(meta) {return {name:'ai_settings_sessions',authStatus:'unsupported',runtimeStatus:'connected',serverInfo:{name:'ai-settings-sessions',version:'0.1.0'},
  serverCapabilities:{tools:{}},toolsError:null,resources:[],resourceTemplates:[],toolListMeta:meta,
  tools:Object.fromEntries(tools.map(t=>[t.name,t]))};}
function fake(row=status(configuredCatalog()[1].result._meta),pages) {
  const calls=[];return {calls,closed:0,async close(){this.closed++;return {exit:{code:0}};},request:async(method,params)=>{calls.push({method,params});
    if(method==='mcpServerStatus/list')return pages?pages.shift():{data:row?[row]:[],nextCursor:null};return response();}};
}
test('RED: missing actual same-thread MCP must prevent pre-TUI command authorization',async()=>{
  const client=fake(null);
  await assert.rejects(initializeCodex(o,codexRecipe(o,env),client,async()=>client),/MCP|mcp/);
  assert(client.calls.some(c=>c.method==='mcpServerStatus/list'));
});
test('actual configured process catalog gates both pre/post phases and exact same-thread discovery',async()=>{
  for(const resume of [undefined,id]) {
    const client=fake(),input={...o,resume};const r=await initializeCodex(input,codexRecipe(input,env),client,async()=>{assert.equal(client.closed,1,'initial proxy must close before cold resume');return client;});
    assert.equal(r.cli_session,id);assert.equal(r.mcp_verified,true);
    assert.deepEqual(client.calls.map(c=>c.method),resume?['thread/resume','mcpServerStatus/list']:['thread/start','thread/name/set','thread/resume','mcpServerStatus/list']);
    const list=client.calls.at(-1);assert.deepEqual(list.params,{threadId:id,serverName:'ai_settings_sessions',detail:'full',limit:16});
    const binding=client.calls[resume?0:2].params.config['mcp_servers.ai_settings_sessions'].env;
    assert.equal(binding.AI_SETTINGS_MCP_CONTEXT,path.join(o.directory,'launch.bound.message.json'));assert.equal(binding.AI_SETTINGS_MCP_THREAD_ID,undefined);
    const post=fake();assert.equal((await checkCodex({...o,cli_session:id},post)).mcp_verified,true);
    assert.deepEqual(post.calls.map(c=>c.method),['thread/resume','mcpServerStatus/list']);
    assert(!JSON.stringify(client.calls).includes('thread/queue/add'));
  }
});
test('missing/failed/empty/wrong schemas and unknown metadata fail both phases without body or retries',async()=>{
  const original=status(configuredCatalog()[1].result._meta);
  const cases=[['missing',()=>null],['failed',r=>{r.runtimeStatus='failed';return r;}],['starting',r=>{r.runtimeStatus='starting';return r;}],
    ['discovery',r=>{r.toolsError='untrusted raw failure';return r;}],['empty',r=>{r.tools={};return r;}],
    ['schema',r=>{r.tools.report.inputSchema.properties.text.type='integer';return r;}],
    ['name',r=>{r.name='other';return r;}],['serverInfo',r=>{r.serverInfo.name='other';return r;}],
    ['untrusted meta',r=>{r.toolListMeta.untrusted={};return r;}],['tool meta',r=>{r.tools.report._meta={bootstrap:true};return r;}],
    ...['instance','owner','task_id','cli_session','runtime','server','hub','endpoint','vendor'].map(key=>[key,r=>{r.toolListMeta['ai-settings/session-bootstrap'][key]=key==='owner'?77:'wrong';return r;}])];
  for(const [label,mutate]of cases)for(const phase of ['pre','post']) {
    const client=fake(mutate(structuredClone(original)));
    await assert.rejects(phase==='pre'?initializeCodex(o,codexRecipe(o,env),client,async()=>client):checkCodex({...o,cli_session:id},client),undefined,label+' '+phase);
    assert.equal(client.calls.filter(c=>c.method==='mcpServerStatus/list').length,1,label);
    assert(!client.calls.some(c=>c.method.includes('queue')||c.method.includes('turn/start')),label);
    assert.equal(client.calls.filter(c=>c.method==='thread/name/set').length,phase==='pre'?1:0,'initial metadata persistence is once-only');
  }
});
test('bounded status pagination and timeouts fail closed without redelivery',async()=>{
  const row=status(configuredCatalog()[1].result._meta);
  const pages=[{data:[],nextCursor:'page-2'},{data:[row],nextCursor:null}],client=fake(null,pages);
  assert.equal((await checkCodex({...o,cli_session:id},client)).mcp_verified,true);
  assert.equal(client.calls.at(-1).params.cursor,'page-2');assert(client.calls.every(c=>c.params.threadId===id));
  for(const pages of [[{data:[],nextCursor:'repeat'},{data:[],nextCursor:'repeat'}],
    Array.from({length:4},(_,i)=>({data:[],nextCursor:'page-'+i})),[{data:[row,row],nextCursor:null}],
    [{data:[row],nextCursor:42}]]) {
    const c=fake(null,pages);await assert.rejects(checkCodex({...o,cli_session:id},c));assert(c.calls.length<=5);
  }
  for(const phase of ['pre','post']) {
    let count=0;const c={close:async()=>({exit:{code:0}}),request:async method=>{if(method==='mcpServerStatus/list'){count++;throw Object.assign(new Error('timeout'),{code:'ETIMEDOUT'});}return response();}};
    await assert.rejects(phase==='pre'?initializeCodex(o,codexRecipe(o,env),c,async()=>c):checkCodex({...o,cli_session:id},c),/timeout/);assert.equal(count,1);
  }
});
test('cold bootstrap refuses incomplete proxy cleanup and closes a failed bound proxy once',async()=>{
  let opened=0;const initial=fake();initial.close=async()=>({exit:{pending:true}});
  await assert.rejects(initializeCodex(o,codexRecipe(o,env),initial,async()=>{opened++;return fake();}),/close incomplete/);assert.equal(opened,0);
  const first=fake(),bound=fake(null);
  await assert.rejects(initializeCodex(o,codexRecipe(o,env),first,async()=>bound));
  assert.equal(first.closed,1);assert.equal(bound.closed,1);
  const incomplete=fake();incomplete.close=async()=>({exit:{pending:true}});
  await assert.rejects(initializeCodex(o,codexRecipe(o,env),fake(),async()=>incomplete),/bound proxy close incomplete/);
});
test('wrong resumed thread UUID fails before MCP discovery in either phase',async()=>{
  for(const phase of ['pre','post']) {
    const c=fake();const request=c.request;
    c.request=async(method,params)=>method==='thread/resume'?{...response(),thread:{id:'22222222-2222-4222-8222-222222222222'}}:request(method,params);
    await assert.rejects(phase==='pre'?initializeCodex({...o,resume:id},codexRecipe({...o,resume:id},env),c):checkCodex({...o,cli_session:id},c));
    assert.equal(c.calls.length,0,'wrong native UUID must not reach discovery or body submission');
  }
});
test('configured real STDIO catalog reports fixed bootstrap identity but grants no public first-turn rights',()=>{
  const catalog=configuredCatalog();assert.equal(catalog[1].result.tools.length,6);
  const meta=catalog[1].result._meta?.['ai-settings/session-bootstrap'];
  assert(meta,'configured MCP process must observe its own bootstrap environment');
  assert.equal(meta.cli_session,id);assert.equal(meta.runtime,runtime);assert.equal(meta.server,o.server);assert.equal(meta.owner,4);
  assert.equal(catalog[2].result.isError,true,'metadata must not bypass actual transcript/host role and model validation');
});
test('inherited actual CLI IDs cannot be hidden by matching configured bootstrap fields',()=>{
  for(const ids of [{CODEX_THREAD_ID:'bad'},{CODEX_SESSION_ID:''},{CODEX_THREAD_ID:'22222222-2222-4222-8222-222222222222'},
    {CODEX_THREAD_ID:id,CODEX_SESSION_ID:'22222222-2222-4222-8222-222222222222'}]) {
    assert.equal(configuredCatalog({...env,...ids})[1].result._meta,undefined,'actual CLI conflict must refuse bootstrap');
  }
  assert(configuredCatalog({...env,CODEX_THREAD_ID:id,CODEX_SESSION_ID:id})[1].result._meta);
});
