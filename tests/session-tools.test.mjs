import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import { install } from '../scripts/install-runtime.mjs';
import { saveRole } from '../scripts/runtime/session-role.mjs';
const moduleURL = new URL('../scripts/runtime/session-tools.mjs', import.meta.url);
const id='12345678-1234-1234-1234-123456789abc';
const env={CODEX_THREAD_ID:id,NVIM:'server',AI_SETTINGS_HOME:path.resolve('runtime'),AGENT_EVENT_INSTANCE:'instance',AGENT_SESSION_ID:'1',AGENT_TASK_ID:'task',AGENT_SESSION_VENDOR:'codex'};
const binding={server:'server',instance:'instance',owner:1,task_id:'task',vendor:'codex',cli_session:id,parent_id:9};
function handoffIdentity(result) {
  assert(!result.isError,result.content?.[0]?.text);const text=result.content[0].text;
  const match=/^OK id=(\d+) model=(\S+) title=(.*) task_id=([\w-]+)$/.exec(text);
  assert(match,'successful handoff must append actual child task_id');
  const [owner,model,title,task_id]=[Number(match[1]),match[2],match[3],match[4]];
  assert(text.startsWith(`OK id=${owner} model=${model} title=${title}`),'old id/model/title prefix is unchanged');
  assert.equal(Number(/^OK id=(\d+)/.exec(text)[1]),owner,'legacy id parser remains valid');
  return {owner,task_id,model,title};
}
function fixture(role='plan') {
  const calls=[];
  return {calls, resolveConnection:()=>binding,resolveSessionModel:e=>({id:e.CODEX_THREAD_ID,role,model:'gpt-6.1-sol'}),
    invokeConnection:(b,a,p)=>{calls.push({b,a,p});return {stdout:a==='status'?JSON.stringify({id:p.owner,task_id:p.task_id,role,model:'gpt-6.1-sol',report:null}):'OK',status:0};}};
}
test('missing adapter fails the contract before implementation', async()=>{
  assert.ok(fs.existsSync(moduleURL),'session tools adapter is required');
});
test('identity, CLI conflicts, actual role and model fail closed', async()=>{
  const {callTool}=await import(moduleURL);
  for(const e of [{},{...env,CODEX_THREAD_ID:id,CODEX_SESSION_ID:'other'},{...env,AGENT_SESSION_VENDOR:'claude'}])
    assert.throws(()=>callTool('connection_status',{},e,fixture()),/identity/);
  assert.throws(()=>callTool('connection_status',{},env,{...fixture(),resolveSessionModel:()=>undefined}),/identity/);
  assert.throws(()=>callTool('connection_status',{},env,{...fixture(),resolveSessionModel:()=>({id,role:'review',model:'gpt-6.1-sol'})}),/identity/);
  assert.throws(()=>callTool('connection_status',{},env,{...fixture(),resolveConnection:()=>({...binding,owner:2})}),/identity/);
  assert.equal(callTool('connection_status',{},env,fixture()).role,'plan');
});
test('strict arguments, role permissions and docs realpaths prevent mutation',async t=>{
  const {callTool}=await import(moduleURL);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'session-tools-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'docs'));fs.writeFileSync(path.join(root,'docs','a.md'),'# a');
  fs.writeFileSync(path.join(root,'outside.md'),'outside');
  fs.symlinkSync(root,path.join(root,'docs','escape'),process.platform==='win32'?'junction':'dir');
  const deps={...fixture(),cwd:root};
  for(const p of ['outside.md','docs/escape/outside.md','docs','docs/no.md'])
    assert.throws(()=>callTool('preview',{path:p},env,deps),/path/);
  for(const role of ['work','review']){
    assert.throws(()=>callTool('preview',{path:'docs/a.md'},env,{...fixture(role),cwd:root}),/role/);
    assert.throws(()=>callTool('handoff',{request:{}},env,fixture(role)),/role/);
    assert.throws(()=>callTool('session_status',{owner:2,task_id:'child'},env,fixture(role)),/role/);
    assert.equal(callTool('report',{text:'report'},env,fixture(role)),'OK');
  }
  assert.throws(()=>callTool('report',{text:'report'},env,fixture()),/role/);
  for(const args of [{path:'docs/a.md',owner:2},{path:'docs/a.md',lua:'return 1'}])
    assert.throws(()=>callTool('preview',args,env,deps),/argument/);
  assert.equal(callTool('preview',{path:'docs/a.md'},env,deps),'OK');
  assert.equal(deps.calls.filter(c=>c.a==='preview').length,1);
  const request={agent:'codex',session:'work',model:'gpt-6-luna',name:'n',goal:'g',scope:'s',validation:'v',prompt:'p',spec_doc:'docs/a.md',plan_doc:'docs/a.md'};
  assert.equal(callTool('handoff',{request},env,deps),'OK');
  for(const extra of [{model:'gpt-6-astra'},{agent:'claude'},{user_override:true},{parent_id:2},{cwd:path.dirname(root)},{session:'plan'}])
    assert.throws(()=>callTool('handoff',{request:{...request,...extra}},env,deps),/model|argument|path|role/);
});
test('FAIL/PENDING and response loss do not retry',async()=>{
  const {callTool}=await import(moduleURL);
  for(const message of ['FAIL: identity','PENDING: role']){
    let count=0;const d=fixture('work'), original=d.invokeConnection;
    d.invokeConnection=(b,a,p)=>a==='status'?original(b,a,p):(count++,{stdout:message});
    assert.throws(()=>callTool('report',{text:'hello'},env,d),/FAIL|PENDING/);assert.equal(count,1);
  }
  let calls=0;const d=fixture('work'), original=d.invokeConnection;
  d.invokeConnection=(b,a,p)=>{if(a==='status')return original(b,a,p);calls++;throw new Error('timeout: execution unknown');};
  assert.throws(()=>callTool('report',{text:'hello'},env,d),/execution unknown/);assert.equal(calls,1);
});
test('Claude uses the same six tools with exact vendor binding and unchanged role/model/path limits',async t=>{
  const {callTool,tools}=await import(moduleURL);assert.equal(tools.length,6);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-tools-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'docs'));fs.writeFileSync(path.join(root,'docs/a.md'),'# docs');
  const e={...env,AGENT_SESSION_VENDOR:'claude',CLAUDE_SESSION_ID:id};
  const fixtureClaude=(role='plan')=>({...fixture(role),cwd:root,resolveConnection:()=>({...binding,vendor:'claude'}),
    resolveSessionModel:child=>{assert.equal(child.CLAUDE_SESSION_ID,id);return {id,role,model:'opus'};},
    invokeConnection:(b,a,p)=>({stdout:a==='status'?JSON.stringify({id:p.owner,task_id:p.task_id,role,model:'opus'}):'OK'})});
  assert.equal(callTool('connection_status',{},e,fixtureClaude()).model,'opus');
  assert.equal(callTool('preview',{path:'docs/a.md'},e,fixtureClaude()),'OK');
  assert.equal(callTool('report',{text:'report'},e,fixtureClaude('work')),'OK');
  assert.throws(()=>callTool('preview',{path:'docs/a.md'},e,fixtureClaude('review')),/role/);
  assert.throws(()=>callTool('preview',{path:'../outside.md'},e,fixtureClaude()),/path/);
  assert.throws(()=>callTool('connection_status',{},e,fixture()),/identity/);
  const request={agent:'claude',session:'work',model:'sonnet',name:'Claude title with spaces',goal:'g',scope:'s',validation:'v',prompt:'p',spec_doc:'docs/a.md',plan_doc:'docs/a.md'};
  assert.equal(callTool('handoff',{request},e,fixtureClaude()),'OK');
  assert.throws(()=>callTool('handoff',{request:{...request,model:'fable'}},e,fixtureClaude()),/model/);
  assert.throws(()=>callTool('handoff',{request:{...request,agent:'codex',model:'gpt-6-luna'}},e,fixtureClaude()),/model/);
  fs.copyFileSync(path.join(env.AI_SETTINGS_HOME,'models.json'),path.join(root,'models.json'));
  fs.mkdirSync(path.join(root,'state'));const usage=path.join(root,'state/claude-usage.json'),now=Math.floor(Date.now()/1000);
  const cross={...request,agent:'codex',model:'gpt-6-luna',session:'review'},managed={...e,AI_SETTINGS_HOME:root};
  for(const [at,used,reset]of [[now,79,now+300],[now-121,80,now+300],[now,80,now-1]]) {
    fs.writeFileSync(usage,JSON.stringify({observed_at:at,windows:{five_hour:{used_percentage:used,resets_at:reset}}}));
    assert.throws(()=>callTool('handoff',{request:cross},managed,fixtureClaude()),/model/);
  }
  fs.writeFileSync(usage,JSON.stringify({observed_at:now,windows:{five_hour:{used_percentage:80,resets_at:now+300}}}));
  assert.equal(callTool('handoff',{request:cross},managed,fixtureClaude()),'OK');
  assert.throws(()=>callTool('handoff',{request:{...cross,session:'work'}},managed,fixtureClaude()),/model/);
});
test('real STDIO initializes, lists, rejects malformed requests and continues',()=>{
  const lines=[
    '{bad',
    {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'test',version:'1'}}},
    {jsonrpc:'2.0',method:'notifications/initialized'},
    {jsonrpc:'2.0',id:2,method:'tools/list'},
    {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'connection_status',_meta:{progressToken:'call-3'}}},
    {jsonrpc:'2.0',id:4,method:'arbitrary/lua'},
    {jsonrpc:'2.0',id:5,method:'ping'},
  ].map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n')+'\n';
  const e={...process.env};for(const key of Object.keys(e))if(key.startsWith('AGENT_'))delete e[key];
  const run=spawnSync(process.execPath,[moduleURL.pathname.replace(/^\/(\w:)/,'$1')],{env:e,input:lines,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const rows=run.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].error.code,-32700);assert.equal(rows[0].id,null);
  assert.equal(rows[1].result.protocolVersion,'2025-03-26');assert.equal(rows[2].result.tools.length,6);
  assert.equal(rows[3].result.isError,true);assert.match(rows[3].result.content[0].text,/identity/);
  assert.equal(rows[4].error.code,-32601);assert.deepEqual(rows[5],{jsonrpc:'2.0',id:5,result:{}});
});

test('installed STDIO native metadata/context gates missing CLI IDs and real Neovim calls once', async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tools-installed-'));
  const runtime=install({home:path.join(root,'home'),nvim:path.join(root,'nvim'),mode:'codex',skipTools:true}).root;
  const project=path.join(root,'project');fs.mkdirSync(path.join(project,'docs'),{recursive:true});fs.writeFileSync(path.join(project,'docs/a.md'),'# docs');
  const codex=path.join(root,'codex');fs.mkdirSync(path.join(codex,'sessions'),{recursive:true});
  fs.writeFileSync(path.join(codex,'sessions',id+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id}})+'\n'+JSON.stringify({type:'turn_context',payload:{model:'gpt-6.1-sol'}})+'\n');
  saveRole('codex',id,'plan',{AI_SETTINGS_HOME:runtime});
  const ready=path.join(root,'ready'), server=process.platform==='win32'?`\\\\.\\pipe\\tools-installed-${process.pid}`:path.join(root,'rpc.sock');
  const hub=path.join(runtime,'state/tools-test');fs.mkdirSync(hub,{recursive:true});
  const worker='87654321-1234-1234-1234-123456789abc';
  function context(owner,task,uuid,role,model) {
    const directory=path.join(root,'launch-'+owner);fs.mkdirSync(directory);
    const o={kind:'ai-settings-codex-launch',role,model,owner,instance:'tools-test',task_id:task,executable:process.execPath,cwd:project,directory,runtime,socket:path.join(directory,'private/c.sock'),server,hub};
    const raw=JSON.stringify(o),original=path.join(directory,'launch.message.json'),bound=path.join(directory,'launch.bound.message.json');fs.writeFileSync(original,raw);
    fs.writeFileSync(bound,JSON.stringify({...o,cli_session:uuid,launch_sha256:crypto.createHash('sha256').update(raw).digest('hex')}));
    const endpoint='unix://'+o.socket.replaceAll('\\','/');
    return {env:{AI_SETTINGS_MCP_CONTEXT:bound,AI_SETTINGS_MCP_ROLE:role,AI_SETTINGS_MCP_MODEL:model,AI_SETTINGS_MCP_ENDPOINT:endpoint},
      transport:{vendor:'codex',ready:true,mcp_verified:true,cli_session:uuid,expected_cli:uuid,manifest:original,endpoint,executable:process.execPath}};
  }
  const parentContext=context(1,'parent',id,'plan','gpt-6.1-sol'),workerContext=context(2,'child',worker,'work','gpt-6-luna');
  const transportFile=path.join(root,'transports.json'),transports={1:parentContext.transport,2:workerContext.transport};fs.writeFileSync(transportFile,JSON.stringify(transports));
  const child=spawn('nvim' ,['--headless','-u','NONE','-i','NONE','--listen',server,'-l','nvim/tests/agent-hub/session-tools-server.lua',ready,runtime,project,'codex',transportFile],{stdio:'ignore',windowsHide:true});
  t.after(()=>{child.kill();fs.rmSync(root,{recursive:true,force:true});});
  for(let i=0;i<100 && !fs.existsSync(ready);i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(fs.existsSync(ready),'live fixture ready');
  const managed={...process.env,...env,NVIM:server,AI_SETTINGS_HOME:runtime,CODEX_HOME:codex,AGENT_EVENT_INSTANCE:'tools-test',AGENT_TASK_ID:'parent',AGENT_HUB_HOME:hub,...parentContext.env};
  delete managed.CODEX_THREAD_ID;delete managed.CODEX_SESSION_ID;
  const request={agent:'codex',session:'work',model:'gpt-6-luna',name:'test title with spaces',goal:'g',scope:'s',validation:'v',prompt:'p',spec_doc:'docs/a.md',plan_doc:'docs/a.md'};
  const run=(name,args,e=managed,meta={threadId:e.AGENT_SESSION_ID==='2'?worker:id,sessionId:id})=>{
    const input=[{id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},{method:'notifications/initialized'},{id:2,method:'tools/list'},{id:3,method:'tools/call',params:{name,arguments:args,_meta:meta}}].map(x=>JSON.stringify({jsonrpc:'2.0',...x})).join('\n')+'\n';
    const result=spawnSync(process.execPath,[path.join(runtime,'bin/session-tools.mjs')],{cwd:project,env:e,input,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim().split('\n').at(-1)).result;
  };
  assert.equal(run('connection_status',{},managed,{}).isError,true,'missing host metadata must not infer UUID');
  assert.equal(run('connection_status',{},managed,{threadId:worker}).isError,true,'wrong shared MCP caller must fail');
  const status=run('connection_status',{});assert.ok(!status.isError,status.content[0].text);assert.equal(JSON.parse(status.content[0].text).binding.cli_session,id);
  const handoff=run('handoff',{request});assert.ok(!handoff.isError,handoff.content[0].text);assert.match(handoff.content[0].text,/OK id=21/);
  const created=handoffIdentity(handoff);assert.equal(created.owner,21);assert.equal(created.model,'gpt-6-luna');assert.equal(created.title,'작업 | test title with spaces');
  const createdStatus=run('session_status',{owner:created.owner,task_id:created.task_id});assert(!createdStatus.isError,createdStatus.content[0].text);assert.equal(JSON.parse(createdStatus.content[0].text).task_id,created.task_id);
  assert.equal(run('session_status',{owner:created.owner,task_id:'wrong-task'}).isError,true);
  assert.equal(run('task_complete',{owner:created.owner,task_id:'wrong-task',verified:true,reviewed:true}).isError,true);
  assert(!run('task_complete',{owner:created.owner,task_id:created.task_id,verified:true,reviewed:true}).isError);
  assert.equal(JSON.parse(run('session_status',{owner:created.owner,task_id:created.task_id}).content[0].text).status,'complete');
  const denied=run('session_status',{owner:3,task_id:'unrelated'});assert.equal(denied.isError,true);assert.match(denied.content[0].text,/relationship/);
  const wrong=run('connection_status',{}, {...managed,AGENT_SESSION_ID:'2'});assert.equal(wrong.isError,true);assert.match(wrong.content[0].text,/identity/);
  const next=run('handoff',{request:{...request,task_id:'explicit-handoff-task'}});assert.match(next.content[0].text,/OK id=22/,'denials never create a child');
  const explicit=handoffIdentity(next);assert.equal(explicit.task_id,'explicit-handoff-task');assert(!run('session_status',{owner:explicit.owner,task_id:explicit.task_id}).isError);
  fs.writeFileSync(path.join(codex,'sessions',worker+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:worker}})+'\n'+JSON.stringify({type:'turn_context',payload:{model:'gpt-6-luna'}})+'\n');
  saveRole('codex',worker,'work',{AI_SETTINGS_HOME:runtime});
  const workEnv={...managed,AGENT_SESSION_ID:'2',AGENT_TASK_ID:'child',...workerContext.env};
  const report=run('report',{text:'verified work report'},workEnv);assert.ok(!report.isError,report.content[0].text);
  const childStatus=JSON.parse(run('session_status',{owner:2,task_id:'child'}).content[0].text);
  transports[2].ready=false;fs.writeFileSync(transportFile,JSON.stringify(transports));
  assert.equal(run('report',{text:'must be refused'},workEnv).isError,true,'post-check failure must block public report');
  transports[2].ready=true;fs.writeFileSync(transportFile,JSON.stringify(transports));
  assert.equal(childStatus.report,'verified work report');assert.equal(childStatus.status,'review_pending');
  assert.equal(run('session_status',{owner:1,task_id:'parent'},workEnv).isError,true);
  assert.equal(run('task_complete',{owner:3,task_id:'unrelated',verified:true,reviewed:true}).isError,true);
  const complete=run('task_complete',{owner:2,task_id:'child',verified:true,reviewed:true});assert.ok(!complete.isError,complete.content[0].text);
  assert.equal(JSON.parse(run('session_status',{owner:2,task_id:'child'}).content[0].text).status,'complete');
});

test('STDIO bounds unterminated messages and recovers after newline',()=>{
  const input='x'.repeat(256*1024+1)+'\n'+JSON.stringify({jsonrpc:'2.0',id:9,method:'ping'})+'\n';
  const result=spawnSync(process.execPath,[moduleURL.pathname.replace(/^\/(\w:)/,'$1')],{input,encoding:'utf8'});
  const rows=result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length,2);assert.equal(rows[0].error.code,-32600);assert.equal(rows[1].id,9);
});
test('both install loads Claude managed MCP on new/resume and calls real host without changing personal MCP/hooks',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-mcp-installed-'));
  const home=path.join(root,'home'),nvim=path.join(root,'nvim'),claude=path.join(home,'.claude');
  fs.mkdirSync(claude,{recursive:true});fs.writeFileSync(path.join(home,'.claude.json'),'{"mcpServers":{"personal":{"command":"keep"}}}');
  fs.writeFileSync(path.join(claude,'settings.json'),JSON.stringify({hooks:{SessionStart:[{hooks:[{type:'command',command:'personal-start'}]}]}}));
  const options={home,nvim,mode:'both',skipTools:true};const runtime=install(options).root;install(options);
  const config=JSON.parse(fs.readFileSync(path.join(runtime,'claude-mcp.json')));
  assert.deepEqual(config.mcpServers.ai_settings_sessions,{command:process.execPath,args:[path.join(runtime,'bin/session-tools.mjs')]});
  assert.equal(fs.readFileSync(path.join(home,'.claude.json'),'utf8'),'{"mcpServers":{"personal":{"command":"keep"}}}');
  assert.equal(JSON.parse(fs.readFileSync(path.join(claude,'settings.json'))).hooks.SessionStart.filter(g=>g.hooks.some(h=>h.command==='personal-start')).length,1);
  const project=path.join(root,'project');fs.mkdirSync(path.join(project,'docs'),{recursive:true});fs.writeFileSync(path.join(project,'docs/a.md'),'# docs');
  const worker='87654321-1234-1234-1234-123456789abc';fs.mkdirSync(path.join(claude,'projects/test'),{recursive:true});
  for(const [uuid,model,role]of [[id,'claude-opus-4-7','plan'],[worker,'claude-sonnet-4-6','work']]) {
    fs.writeFileSync(path.join(claude,'projects/test',uuid+'.jsonl'),JSON.stringify({sessionId:uuid,type:'assistant',message:{model}})+'\n');saveRole('claude',uuid,role,{AI_SETTINGS_HOME:runtime});
  }
  const {prepare}=await import(new URL('file:///'+path.join(runtime,'bin/session-message-prepare.mjs').replaceAll('\\','/')));
  for(const resume of [undefined,id]) {
    const r=prepare({vendor:'claude',role:'plan',model:'opus',owner:1,instance:'tools-test',task_id:'parent',executable:process.execPath,cwd:project,directory:path.join(root,'launch'),resume,
      cmd:resume?[process.execPath,'--resume',id,'--mcp-config','personal.json']:[process.execPath,'--model','opus']},'2.1.331');
    assert(r.cmd.includes(path.join(runtime,'claude-mcp.json')));if(resume)assert(r.cmd.includes('personal.json'));
  }
  const ready=path.join(root,'ready'),server=process.platform==='win32'?`\\\\.\\pipe\\claude-tools-${process.pid}`:path.join(root,'rpc.sock');
  const transportFile=path.join(root,'claude-transports.json'),transports={1:{vendor:'claude',ready:true,ready_claimed:true,model_verified:true,cli_session:id,expected_cli:id},2:{vendor:'claude',ready:true,ready_claimed:true,model_verified:true,cli_session:worker,expected_cli:worker}};fs.writeFileSync(transportFile,JSON.stringify(transports));
  const child=spawn('nvim',['--headless','-u','NONE','-i','NONE','--listen',server,'-l','nvim/tests/agent-hub/session-tools-server.lua',ready,runtime,project,'claude',transportFile],{stdio:'ignore',windowsHide:true});
  t.after(()=>{child.kill();fs.rmSync(root,{recursive:true,force:true});});
  for(let i=0;i<100&&!fs.existsSync(ready);i++)await new Promise(r=>setTimeout(r,20));assert(fs.existsSync(ready));
  const managed={...process.env,NVIM:server,AI_SETTINGS_HOME:runtime,CLAUDE_CONFIG_DIR:claude,AGENT_EVENT_INSTANCE:'tools-test',AGENT_SESSION_ID:'1',AGENT_TASK_ID:'parent',AGENT_SESSION_VENDOR:'claude',CLAUDE_CODE_SESSION_ID:id};
  delete managed.CLAUDE_SESSION_ID;
  let nativeCall=0;
  const nativeMeta=(name,args,e=managed)=>{
    const uuid=e.CLAUDE_CODE_SESSION_ID,call='native-call-'+(++nativeCall);
    if(/^[a-f0-9-]{36}$/i.test(uuid||''))fs.appendFileSync(path.join(claude,'projects/test',uuid+'.jsonl'),JSON.stringify({sessionId:uuid,type:'assistant',message:{model:uuid===worker?'claude-sonnet-4-6':'claude-opus-4-7',content:[{type:'tool_use',id:call,name:'mcp__ai_settings_sessions__'+name,input:args}]}})+'\n');
    return {'claudecode/toolUseId':call};
  };
  const run=(name,args,e=managed)=>{
    const input=[{id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},{method:'notifications/initialized'},{id:2,method:'tools/call',params:{name,arguments:args,_meta:nativeMeta(name,args,e)}}].map(x=>JSON.stringify({jsonrpc:'2.0',...x})).join('\n')+'\n';
    const result=spawnSync(process.execPath,[config.mcpServers.ai_settings_sessions.args[0]],{cwd:project,env:e,input,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout.trim().split('\n').at(-1)).result;
  };
  const missing={...managed};delete missing.CLAUDE_CODE_SESSION_ID;
  for(const candidate of [missing,{...missing,CLAUDE_SESSION_ID:id},{...managed,CLAUDE_CODE_SESSION_ID:''},{...managed,CLAUDE_CODE_SESSION_ID:'bad'},
    {...managed,CLAUDE_SESSION_ID:''},{...managed,CLAUDE_SESSION_ID:'bad'},{...managed,CLAUDE_SESSION_ID:worker},{...managed,CLAUDE_CODE_SESSION_ID:worker}])
    assert.equal(run('connection_status',{},candidate).isError,true,'native identity must be canonical, valid and exact');
  assert(!run('connection_status',{}, {...managed,CLAUDE_SESSION_ID:id}).isError,'agreeing explicit alias remains valid');
  const status=run('connection_status',{});assert(!status.isError,status.content[0].text);assert.equal(JSON.parse(status.content[0].text).model,'opus');
  const request={agent:'claude',session:'work',model:'sonnet',name:'Claude title with spaces',goal:'g',scope:'s',validation:'v',prompt:'p',spec_doc:'docs/a.md',plan_doc:'docs/a.md'};
  const sent=run('handoff',{request});assert(!sent.isError,sent.content[0].text);assert.match(sent.content[0].text,/OK id=21/);
  const generated=handoffIdentity(sent);assert.equal(generated.title,'작업 | Claude title with spaces');assert.equal(generated.model,'sonnet');
  assert(!run('session_status',{owner:generated.owner,task_id:generated.task_id}).isError);
  assert.equal(run('task_complete',{owner:generated.owner,task_id:'wrong-task',verified:true,reviewed:true}).isError,true);
  assert(!run('task_complete',{owner:generated.owner,task_id:generated.task_id,verified:true,reviewed:true}).isError);
  assert.equal(JSON.parse(run('session_status',{owner:generated.owner,task_id:generated.task_id}).content[0].text).status,'complete');
  assert.equal(run('connection_status',{}, {...managed,CLAUDE_SESSION_ID:worker}).isError,true);
  assert.equal(run('session_status',{owner:3,task_id:'unrelated'}).isError,true);
  const workEnv={...managed,AGENT_SESSION_ID:'2',AGENT_TASK_ID:'child',CLAUDE_CODE_SESSION_ID:worker};
  const denied=run('preview',{path:'docs/a.md'},workEnv);assert.equal(denied.isError,true);assert.match(denied.content[0].text,/role/);
  const report=run('report',{text:'Claude report'},workEnv);assert(!report.isError,report.content[0].text);
  for(const flag of ['ready','ready_claimed']) {
    transports[2][flag]=false;fs.writeFileSync(transportFile,JSON.stringify(transports));assert.equal(run('report',{text:'refused'},workEnv).isError,true,flag);
    transports[2][flag]=true;fs.writeFileSync(transportFile,JSON.stringify(transports));
  }
  const restored=JSON.parse(run('session_status',{owner:2,task_id:'child'},workEnv).content[0].text);assert.equal(restored.report,'Claude report','denied reports never execute');
  const continued=prepare({vendor:'claude',role:'plan',model:'opus',owner:1,instance:'tools-test',task_id:'parent',executable:process.execPath,cwd:project,directory:path.join(root,'continue-launch'),resume:id,cmd:[process.execPath,'--continue']},'2.1.331');
  assert.deepEqual(continued.cmd.slice(1,3),['--resume',id]);assert(!continued.cmd.includes('--continue'));
  const adapter=spawn(process.execPath,[config.mcpServers.ai_settings_sessions.args[0]],{cwd:project,env:managed,stdio:['pipe','pipe','ignore'],windowsHide:true});
  const closed=new Promise(resolve=>adapter.once('exit',resolve)),pending=new Map();let seq=10;
  readline.createInterface({input:adapter.stdout}).on('line',line=>{const value=JSON.parse(line),p=pending.get(value.id);if(p){pending.delete(value.id);clearTimeout(p.timer);p.resolve(value.result);}});
  const send=value=>new Promise((resolve,reject)=>{const number=seq++,timer=setTimeout(()=>{pending.delete(number);reject(Error('synthetic adapter response timeout'));},15000);pending.set(number,{resolve,reject,timer});adapter.stdin.write(JSON.stringify({jsonrpc:'2.0',id:number,...value})+'\n');});
  await send({method:'initialize',params:{protocolVersion:'2025-03-26'}});adapter.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const persistentCall=(name,args)=>send({method:'tools/call',params:{name,arguments:args,_meta:nativeMeta(name,args)}});
  try {
    assert(!(await persistentCall('connection_status',{})).isError,'long-lived installed adapter starts with canonical ID');
    const switched='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    fs.writeFileSync(path.join(claude,'projects/test',switched+'.jsonl'),JSON.stringify({sessionId:switched,type:'assistant',message:{model:'claude-opus-4-7'}})+'\n');saveRole('claude',switched,'plan',{AI_SETTINGS_HOME:runtime});
    transports[1].cli_session=switched;transports[1].expected_cli=switched;fs.writeFileSync(transportFile,JSON.stringify(transports));
    assert.equal((await persistentCall('connection_status',{})).isError,true,'old spawned MCP cannot follow session switch');
    assert.equal((await persistentCall('handoff',{request})).isError,true,'stale caller cannot create a child');
    const fresh={...managed,CLAUDE_CODE_SESSION_ID:switched};assert(!run('connection_status',{},fresh).isError,'fresh canonical session may reconnect');
    const freshChild=run('handoff',{request:{...request,task_id:'explicit-claude-task'}},fresh);assert(!freshChild.isError,freshChild.content[0].text);assert.match(freshChild.content[0].text,/OK id=22/);assert.equal(handoffIdentity(freshChild).task_id,'explicit-claude-task');
  }finally{adapter.stdin.end();assert.equal(await closed,0,'owned synthetic MCP adapter exits normally');}
});
