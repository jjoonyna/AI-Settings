import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {PassThrough} from 'node:stream';
import {serve,callTool} from '../scripts/runtime/session-tools.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function fixture() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'call-binding-'));
  const c={kind:'ai-settings-codex-launch',role:'work',model:'gpt-6.1-sol',cwd:directory,executable:process.execPath,directory,runtime:fs.realpathSync('scripts'),
    socket:path.join(directory,'private/c.sock'),instance:'call-test',owner:4,task_id:'task',server:'synthetic',hub:directory};
  const original=JSON.stringify(c),file=path.join(directory,'launch.bound.message.json');fs.writeFileSync(path.join(directory,'launch.message.json'),original);
  fs.writeFileSync(file,JSON.stringify({...c,cli_session:id,launch_sha256:crypto.createHash('sha256').update(original).digest('hex')}));
  const env={NVIM:c.server,AI_SETTINGS_HOME:c.runtime,AGENT_HUB_HOME:c.hub,AGENT_EVENT_INSTANCE:c.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:c.task_id,AGENT_SESSION_VENDOR:'codex',
    AI_SETTINGS_MCP_CONTEXT:file,AI_SETTINGS_MCP_ROLE:c.role,AI_SETTINGS_MCP_MODEL:c.model,AI_SETTINGS_MCP_ENDPOINT:'unix://'+c.socket.replaceAll('\\','/')};
  const input=new PassThrough(),output=new PassThrough();serve(input,output,env);
  const prime=()=>input.write([{id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},{method:'notifications/initialized'},{id:2,method:'tools/list'}].map(v=>JSON.stringify({jsonrpc:'2.0',...v})).join('\n')+'\n');
  const state={mutations:0,ready:true,bindingId:id,guards:[]};
  const deps={cwd:directory,resolveConnection:()=>({server:c.server,instance:c.instance,owner:4,task_id:c.task_id,vendor:'codex',cli_session:state.bindingId,parent_id:1}),
    resolveSessionModel:e=>({id:e.CODEX_THREAD_ID,role:c.role,model:c.model}),invokeConnection:(binding,action,p)=>{
      state.guards.push(p.session_tools);if(p.session_tools?.transport&&!state.ready)throw Error('identity: transport not ready/attested');
      if(action!=='status')state.mutations++;return {stdout:action==='status'?JSON.stringify({id:4,task_id:c.task_id,role:c.role,model:c.model}):'OK'};
    }};
  return {env,c,file,state,deps,prime,call:(meta={threadId:id,sessionId:other})=>callTool('report',{text:'synthetic report'},env,deps,meta),clean:()=>{input.destroy();output.destroy();fs.rmSync(directory,{recursive:true,force:true});}};
}
test('native metadata threadId is mandatory and wrong shared-runtime caller never inherits owner UUID',()=>{
  for(const meta of [undefined,{},[],{threadId:'bad'},{threadId:other},{'openai/threadId':id},{threadId:id,sessionId:'bad'},
    {threadId:id,'x-codex-turn-metadata':{thread_id:other}}]) {
    const f=fixture();try{f.prime();assert.throws(()=>callTool('report',{text:'synthetic'},f.env,f.deps,meta),/identity/);assert.equal(f.state.mutations,0);}finally{f.clean();}
  }
});
test('catalog pin, native caller, current UUID and attested ready transport must all agree per call',()=>{
  const f=fixture();try {
    assert.throws(()=>f.call(),/identity/,'no call before catalog pin');f.prime();assert.equal(f.call(),'OK');assert.equal(f.state.mutations,1);
    assert(f.state.guards.every(g=>g?.transport?.context===f.file),'transport proof accompanies initial status and mutation');
    f.state.ready=false;assert.throws(()=>f.call(),/identity/);assert.equal(f.state.mutations,1);
    f.state.ready=true;f.state.bindingId=other;assert.throws(()=>f.call(),/identity/);assert.equal(f.state.mutations,1);
  }finally{f.clean();}
});
test('changed context or original manifest cannot rebind an already discovered MCP process',()=>{
  for(const change of ['bound','original']){const f=fixture();try {
    f.prime();const target=change==='bound'?f.file:path.join(f.c.directory,'launch.message.json');
    const value=JSON.parse(fs.readFileSync(target));if(change==='bound')value.cli_session=other;else value.task_id='changed';fs.writeFileSync(target,JSON.stringify(value));
    assert.throws(()=>f.call(),/identity/);assert.equal(f.state.mutations,0);
  }finally{f.clean();}}
});
test('context never supplies actual transcript role/model or public tool arguments',()=>{
  const f=fixture();try{f.prime();assert.throws(()=>callTool('report',{text:'x'},f.env,{...f.deps,resolveSessionModel:()=>undefined},{threadId:id}),/actual role\/model/);
    assert.throws(()=>callTool('report',{text:'x',threadId:id},f.env,f.deps,{threadId:id}),/argument/);assert.equal(f.state.mutations,0);
  }finally{f.clean();}
});
test('untrusted context directory cannot redirect even an internal original-manifest read',()=>{
  const f=fixture(),blocked=path.join(path.dirname(f.c.directory),'launch.message.json');const original=fs.realpathSync;let attempts=0;
  try {
    const c=JSON.parse(fs.readFileSync(f.file));c.directory=path.dirname(f.c.directory);fs.writeFileSync(f.file,JSON.stringify(c));
    fs.realpathSync=function(file,...rest){if(path.resolve(file)===blocked)attempts++;return original(file,...rest);};
    f.prime();assert.equal(attempts,0,'original path must derive from fixed context location, never manifest fields');
  }finally{fs.realpathSync=original;f.clean();}
});
