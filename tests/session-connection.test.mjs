import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { resolveConnection, invokeConnection, payloadForBinding, registryValid, classifyResult, rpcTimeout } from '../scripts/runtime/session-connection.mjs';
const cli = '12345678-1234-1234-1234-123456789abc';
const identity = { instance: 'old', owner: 1, task_id: 'task', vendor: 'codex', cli_session: cli };
const binding = { ...identity, server: 'direct' };
const fixture = { server: 'direct', now: 100000, alive:()=>{}, readRegistry: () => [], probe: () => ({ok:true,binding}) };
test('direct identity is verified and token is excluded', () => {
  assert.deepEqual(resolveConnection(identity, fixture), binding);
  assert.throws(() => resolveConnection(identity, {...fixture, probe:()=>({ok:true,binding:{...binding,task_id:'other'}})}), /identity|candidate/);
});
test('payload defaults follow binding while explicit identities cannot be replaced', () => {
  const child={...binding,parent_id:2};
  assert.deepEqual(payloadForBinding(child,'preview',{path:'doc'}),{path:'doc',owner:1,task_id:'task'});
  assert.throws(()=>payloadForBinding(child,'preview',{owner:9}),/identity/);
  assert.throws(()=>payloadForBinding(child,'preview',{task_id:'other'}),/identity/);
  assert.throws(()=>payloadForBinding(child,'handoff',{parent_server:'old'}),/identity/);
  assert.equal(payloadForBinding(child,'task-complete',{owner:9,task_id:'child'}).owner,9);
  assert.equal(payloadForBinding(child,'report',{text:'hello'}).parent_id,2);
  assert.throws(()=>payloadForBinding(binding,'report',{}),/parent/);
});
test('registry validates time, PID and structure without deleting files', () => {
  const item={version:1,instance:'x',server:'s',pid:1,updated:100,entries:[]};
  assert.ok(registryValid(item,100000,()=>{throw {code:'EPERM'};}));
  assert.ok(!registryValid(item,100000,()=>{throw {code:'ESRCH'};}));
  for(const changed of [{updated:69},{updated:111},{version:2},{entries:{}},{pid:0},{server:''}])
    assert.ok(!registryValid({...item,...changed},100000,()=>{}));
  assert.equal(classifyResult({error:{code:'ENOENT'}}),'spawn');
  assert.equal(classifyResult({stderr:'ENOENT: pipe missing'}),'unavailable');
  assert.equal(classifyResult({error:{code:'EPERM'}}),'permission');
});
test('stale address can move only to a unique exact CLI identity', () => {
  const item = {version:1,instance:'new',server:'new',pid:1,updated:100,entries:[]};
  const moved = {...binding,instance:'new',server:'new',owner:3};
  const f = {...fixture,readRegistry:()=>[item],probe:(server)=>server==='direct'?{ok:false,code:'unavailable'}:{ok:true,binding:moved}};
  assert.deepEqual(resolveConnection(identity,f),moved);
  assert.throws(()=>resolveConnection({...identity,cli_session:undefined},f),/identity|candidate/);
  assert.throws(()=>resolveConnection(identity,{...f,readRegistry:()=>[item,{...item,server:'second'}],probe:s=>s==='direct'?{ok:false,code:'unavailable'}:{ok:true,binding:{...moved,server:s}}}),/ambiguous/);
  for (const updated of [69,111]) assert.throws(()=>resolveConnection(identity,{...f,readRegistry:()=>[{...item,updated}]}),/candidate/);
});
test('permission and timeout never search alternate candidates', () => {
  for(const code of ['permission','timeout','protocol','spawn']) {
    let reads=0;
    assert.throws(()=>resolveConnection(identity,{...fixture,probe:()=>({ok:false,code}),readRegistry:()=>{reads++;return[];}}),new RegExp(code));
    assert.equal(reads,0);
  }
});
test('mutation response loss executes once and never retries', () => {
  let calls=0;
  assert.throws(()=>invokeConnection(binding,'report',{}, {run:()=>{calls++;return {error:{code:'ETIMEDOUT'},status:null};}}),/unknown|불명/);
  assert.equal(calls,1);
});
test('real Neovim RPC verifies identity and rejects stale binding before mutation', async t => {
  fs.mkdirSync(path.resolve('docs/tmp/session-connection'), {recursive:true});
  const root=fs.mkdtempSync(path.resolve('docs/tmp/session-connection/rpc-'));
  const ready=path.join(root,'ready');
  const server=process.platform==='win32' ? `\\\\.\\pipe\\connection-test-${process.pid}` : path.join(root,'rpc.sock');
  const child=spawn('nvim',['--headless','-u','NONE','-i','NONE','--listen',server,'-l','nvim/tests/agent-hub/connection-server.lua',ready],{stdio:'ignore',windowsHide:true});
  t.after(()=>{child.kill();fs.rmSync(root,{recursive:true,force:true});});
  for(let i=0;i<100 && !fs.existsSync(ready);i++) await new Promise(r=>setTimeout(r,20));
  assert.ok(fs.existsSync(ready),'fixture server started');
  const id={instance:'rpc-test',owner:1,task_id:'rpc-task'};
  const b=resolveConnection(id,{server,readRegistry:()=>[]});
  assert.equal(b.cli_session,cli);
  const response=invokeConnection(b,'preview',payloadForBinding(b,'preview',{path:'doc'}));
  assert.match(response.stdout,/"count":1/);
  assert.match(invokeConnection({...b,task_id:'wrong'},'preview',{owner:1,task_id:'wrong'}).stdout,/FAIL:/);
  assert.match(invokeConnection(b,'preview',payloadForBinding(b,'preview',{path:'doc'})).stdout,/"count":2/);
  assert.throws(()=>resolveConnection({...id,instance:'other'},{server,readRegistry:()=>[]}),/identity/);
});
test('report uses verified moved parent rather than stale environment parent', async t => {
  fs.mkdirSync(path.resolve('docs/tmp/session-connection'), {recursive:true});
  const root=fs.mkdtempSync(path.resolve('docs/tmp/session-connection/report-'));
  const ready=path.join(root,'ready'), instances=path.join(root,'instances');
  const server=process.platform==='win32' ? `\\\\.\\pipe\\report-test-${process.pid}` : path.join(root,'rpc.sock');
  const child=spawn('nvim',['--headless','-u','NONE','-i','NONE','--listen',server,'-l','nvim/tests/agent-hub/connection-server.lua',ready],{stdio:'ignore',windowsHide:true});
  t.after(()=>{child.kill();fs.rmSync(root,{recursive:true,force:true});});
  for(let i=0;i<100 && !fs.existsSync(ready);i++) await new Promise(r=>setTimeout(r,20));
  assert.ok(fs.existsSync(ready));
  fs.mkdirSync(instances);
  fs.writeFileSync(path.join(instances,'instance.json'),JSON.stringify({version:1,instance:'rpc-test',server,pid:child.pid,updated:Date.now()/1000,entries:[]}));
  const env={...process.env, AGENT_HUB_HOME:root, AGENT_PARENT_SERVER:server, AGENT_EVENT_INSTANCE:'old', AGENT_SESSION_ID:'2', AGENT_TASK_ID:'old-task', AGENT_PARENT_ID:'1', AGENT_SESSION_VENDOR:'codex', CODEX_THREAD_ID:'87654321-1234-1234-1234-123456789abc', CODEX_SESSION_ID:'87654321-1234-1234-1234-123456789abc'};
  const result=spawnSync(process.execPath,['scripts/runtime/session.mjs','report','-'],{env,input:'report',encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  assert.equal(report.count,1); assert.equal(report.payload.owner,8); assert.equal(report.payload.parent_id,7);
  assert.throws(()=>payloadForBinding({ ...binding, parent_id:7 },'report',{parent_id:1}),/identity/);
  assert.throws(()=>payloadForBinding(binding,'report',{}),/parent/);
});
test('only handoff gets the longer Neovim connection limit',()=>{
  assert.equal(rpcTimeout('handoff'),60000);
  for(const a of ['preview','report','task-complete','activity','status'])assert.equal(rpcTimeout(a),15000);
});
