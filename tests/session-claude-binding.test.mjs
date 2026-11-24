import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {callTool,serve} from '../scripts/runtime/session-tools.mjs';
import {childEnvironment} from '../scripts/runtime/session-message-rpc.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const base={NVIM:'synthetic-claude-server',AGENT_SESSION_VENDOR:'claude',AGENT_EVENT_INSTANCE:'claude-test',AGENT_SESSION_ID:'4',AGENT_TASK_ID:'task',AGENT_HUB_HOME:'synthetic-nonexistent-hub'};
function fixture(env={...base,CLAUDE_CODE_SESSION_ID:id}) {
  const state={resolved:0,mutations:0,guards:[],ready:true};
  const binding={server:base.NVIM,instance:base.AGENT_EVENT_INSTANCE,owner:4,task_id:'task',vendor:'claude',cli_session:id,parent_id:1};
  const deps={resolveConnection:identity=>{state.resolved++;assert.equal(identity.cli_session,id,'capture validated caller before child RPC');return binding;},
    resolveSessionModel:(e,a,b,persist)=>{assert.equal(e.CLAUDE_SESSION_ID,id);assert.equal(persist,false);return {id,role:'work',model:'sonnet'};},
    invokeConnection:(b,action,p)=>{state.guards.push(p.session_tools);if(p.session_tools?.inbox&&!state.ready)throw Error('identity: inbox not ready');
      if(action!=='status')state.mutations++;return {stdout:action==='status'?JSON.stringify({id:4,task_id:'task',role:'work',model:'sonnet'}):'OK'};}};
  return {env,state,deps,call:()=>callTool('report',{text:'synthetic report'},env,deps)};
}
test('canonical Claude UUID and agreeing legacy alias identify caller; missing/malformed/conflicting identities never infer owner',()=>{
  for(const env of [{...base,CLAUDE_CODE_SESSION_ID:id},{...base,CLAUDE_CODE_SESSION_ID:id,CLAUDE_SESSION_ID:id},{...base,CLAUDE_SESSION_ID:id}])assert.equal(fixture(env).call(),'OK');
  for(const env of [base,{...base,CLAUDE_CODE_SESSION_ID:''},{...base,CLAUDE_CODE_SESSION_ID:'bad'},
    {...base,CLAUDE_CODE_SESSION_ID:null},{...base,CLAUDE_CODE_SESSION_ID:[id]},
    {...base,CLAUDE_CODE_SESSION_ID:id,CLAUDE_SESSION_ID:''},{...base,CLAUDE_CODE_SESSION_ID:id,CLAUDE_SESSION_ID:'bad'},
    {...base,CLAUDE_CODE_SESSION_ID:'bad',CLAUDE_SESSION_ID:id},{...base,CLAUDE_CODE_SESSION_ID:id,CLAUDE_SESSION_ID:other}]) {
    const f=fixture(env);assert.throws(()=>f.call(),/identity/);assert.equal(f.state.resolved,0);assert.equal(f.state.mutations,0);
  }
});
test('native STDIO requires canonical key even if a validated legacy alias exists',()=>{
  for(const env of [base,{...base,CLAUDE_SESSION_ID:id}]) {
    const input=new PassThrough(),output=new PassThrough();let text='';output.on('data',c=>text+=c);serve(input,output,env);
    input.write([{id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},{method:'notifications/initialized'},
      {id:2,method:'tools/call',params:{name:'connection_status',arguments:{}}}].map(m=>JSON.stringify({jsonrpc:'2.0',...m})).join('\n')+'\n');
    const r=JSON.parse(text.trim().split('\n').at(-1)).result;assert.equal(r.isError,true);assert.match(r.content[0].text,/canonical Claude/);
    input.destroy();output.destroy();
  }
});
test('each Claude host status/mutation carries UUID-only inbox guard and real transcript remains mandatory',()=>{
  const f=fixture();assert.equal(f.call(),'OK');assert(f.state.guards.every(g=>g?.inbox?.cli_session===id));
  assert(f.state.guards.every(g=>Object.keys(g.inbox).length===1),'no credentials or inbox address in proof');
  f.state.ready=false;assert.throws(()=>f.call(),/identity/);assert.equal(f.state.mutations,1);
  assert.throws(()=>callTool('connection_status',{},f.env,{...f.deps,resolveSessionModel:()=>undefined}),/actual role\/model/);
});
test('canonical caller cannot migrate to wrong live owner/task/vendor/UUID/server',()=>{
  for(const patch of [{owner:5},{task_id:'wrong'},{vendor:'codex'},{cli_session:other},{server:'wrong'}]) {
    const f=fixture(),resolve=f.deps.resolveConnection;
    assert.throws(()=>callTool('report',{text:'x'},f.env,{...f.deps,resolveConnection:i=>({...resolve(i),...patch})}),/identity/);assert.equal(f.state.mutations,0);
  }
});
test('RPC child privacy stripping keeps native session and messaging namespace out of child environment',()=>{
  const filtered=childEnvironment({CLAUDE_CODE_SESSION_ID:id,CLAUDE_CODE_SESSION_SYNTHETIC:'synthetic',CLAUDE_CODE_MESSAGING_SYNTHETIC:'synthetic',KEEP:'public'});
  assert.deepEqual(filtered,{KEEP:'public'});
});
