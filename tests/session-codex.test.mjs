import test,{after} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import path from 'node:path';
import {codexRecipe,initializeCodex as nativeInitialize,verifyCodex} from '../scripts/runtime/session-codex.mjs';
import {tools} from '../scripts/runtime/session-tools.mjs';
const id='11111111-1111-4111-8111-111111111111';
const o={role:'plan',model:'gpt-6.1-sol',cwd:process.cwd(),executable:process.execPath,directory:fs.mkdtempSync(path.join(os.tmpdir(),'context-test-')),socket:path.resolve('synthetic/new-ipc/c.sock'),
  owner:4,instance:'instance',task_id:'task',runtime:path.resolve('synthetic/runtime'),server:'synthetic-server',hub:path.resolve('synthetic/hub')};
after(()=>fs.rmSync(o.directory,{recursive:true,force:true}));
function initializeCodex(input,...rest){for(const name of ['launch.initialize.claim','launch.bound.message.json'])fs.rmSync(path.join(input.directory,name),{force:true});fs.writeFileSync(path.join(input.directory,'launch.message.json'),JSON.stringify(input));return nativeInitialize(input,...rest);}
const env={NVIM:'synthetic-server',AGENT_HUB_HOME:o.hub,AGENT_EVENT_INSTANCE:'instance',AGENT_SESSION_ID:'4',AGENT_TASK_ID:'task',AGENT_EVENT_TOKEN:'private-event'};
function response(role='plan') {return {thread:{id},model:o.model,cwd:o.cwd,approvalPolicy:role==='review'?'never':'on-request',approvalsReviewer:'auto_review',
  sandbox:{type:'dangerFullAccess'}};}
test('private server recipe keeps exact managed MCP identity and role policy; no shared daemon or body',()=>{
  const a=codexRecipe(o,env),b=codexRecipe({...o,socket:path.resolve('synthetic/other/c.sock')},env);
  assert.notEqual(a.endpoint,b.endpoint);assert(a.serverArgs.includes('--listen'));assert(!a.serverArgs.includes('--no-daemon'));
  assert.equal(a.request.config['mcp_servers.ai_settings_sessions'].env.AGENT_TASK_ID,'task');
  assert(!JSON.stringify(a).includes('private-event'));assert.equal(a.request.sandbox,'danger-full-access');
  assert.deepEqual(a.tuiArgs(id).slice(-2),['resume',id]);assert(a.tuiArgs(id).includes('--remote'));
  assert.throws(()=>a.tuiArgs('wrong'));assert.throws(()=>codexRecipe({...o,role:'other'},env));
  verifyCodex(response(),o);assert.throws(()=>verifyCodex({...response(),model:'wrong'},o));
  assert.throws(()=>verifyCodex({...response(),sandbox:{type:'workspaceWrite'}},o));
  assert.throws(()=>verifyCodex(response(),{...o,resume:'22222222-2222-4222-8222-222222222222'}));
  for(const role of ['work','review'])verifyCodex(response(role),{...o,role});
});
test('new and resume initialize exact policy before TUI, once, with no queue or turn',async()=>{
  for(const resume of [undefined,id]) {
    const calls=[];const recipe=codexRecipe({...o,resume},env);
    const client={close:async()=>({exit:{code:0}}),request:async(method,params)=>{calls.push({method,params});
      if(method==='mcpServerStatus/list')return {data:[{name:'ai_settings_sessions',authStatus:'unsupported',runtimeStatus:'connected',serverInfo:{name:'ai-settings-sessions',version:'0.1.0'},serverCapabilities:{tools:{}},
        tools:Object.fromEntries(tools.map(t=>[t.name,t])),resources:[],resourceTemplates:[],toolListMeta:{'ai-settings/session-bootstrap':{version:1,vendor:'codex',instance:o.instance,owner:o.owner,task_id:o.task_id,cli_session:id,runtime:o.runtime,server:o.server,hub:o.hub,endpoint:recipe.endpoint}}}],nextCursor:null};
      return response();}};
    const result=await initializeCodex({...o,resume},recipe,client,async()=>client);
    assert.equal(result.cli_session,id);assert.equal(result.mcp_verified,true);assert.equal(calls.length,resume?2:4);assert.equal(calls[0].method,resume?'thread/resume':'thread/start');
    assert.equal(calls[0].params.model,o.model);assert.equal(calls[0].params.config['mcp_servers.ai_settings_sessions'].env.AGENT_SESSION_ID,'4');
  }
});
