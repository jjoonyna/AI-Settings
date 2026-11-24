import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {waitNativeReady,NativeConnectError,ProxyCleanupError} from '../scripts/runtime/session-native.mjs';
import {ownedServerExit} from '../scripts/runtime/session-codex.mjs';
const cli=fileURLToPath(new URL('../scripts/runtime/session-codex.mjs',import.meta.url));
function fixture(extra={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-readiness-'));
  const o={kind:'ai-settings-codex-launch',role:'work',model:'gpt-6.1-sol',cwd:directory,executable:process.execPath,directory,runtime:path.resolve('scripts'),
    socket:path.join(directory,'protected-ipc/c.sock'),instance:'readiness-test',owner:4,task_id:'task',server:'synthetic-nvim',hub:path.join(directory,'hub')};
  if(extra.resume)o.resume=extra.resume;
  fs.mkdirSync(o.hub);
  const state=path.join(directory,'state.json'),control=path.join(directory,'control.json'),manifest=path.join(directory,'launch.message.json'),preload=path.join(directory,'stat-denied.cjs');
  fs.copyFileSync('tests/fixtures/native-readiness-proxy.cjs',path.join(directory,'app-server'));
  fs.writeFileSync(state,JSON.stringify({attempts:0,methods:[]}));fs.writeFileSync(manifest,JSON.stringify(o));
  fs.writeFileSync(control,JSON.stringify({state,socket:o.socket,cwd:o.cwd,id:'11111111-1111-4111-8111-111111111111',toolsURL:new URL('../scripts/runtime/session-tools.mjs',import.meta.url).href,...extra}));
  fs.writeFileSync(preload,"const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.env.AI_SETTINGS_TEST_NATIVE,'utf8')).socket;const old=fs.existsSync;fs.existsSync=function(f){return String(f)===p?false:old(f)};const stat=fs.statSync;fs.statSync=function(f,...a){if(String(f)===p)throw Object.assign(Error('synthetic stat denied'),{code:'EACCES'});return stat(f,...a)};");
  const env={...process.env,AI_SETTINGS_TEST_NATIVE:control,NVIM:o.server,AI_SETTINGS_HOME:o.runtime,AGENT_HUB_HOME:o.hub,AGENT_EVENT_INSTANCE:o.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:'task',AGENT_SESSION_VENDOR:'codex'};
  for(const k of ['CODEX_THREAD_ID','CODEX_SESSION_ID'])delete env[k];
  return {o,directory,state,run:(mode='--initialize')=>spawnSync(process.execPath,['--require',preload,cli,mode,manifest],{cwd:directory,env,encoding:'utf8',timeout:15000}),clean:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
test('RED protected socket stat false/EACCES cannot block a successful normal native handshake',()=>{
  const f=fixture();try {
    const r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.mcp_verified,true);
    const state=JSON.parse(fs.readFileSync(f.state));assert.equal(state.methods.filter(x=>x==='thread/start').length,1);assert.equal(state.methods.filter(x=>x==='thread/resume').length,1);
    assert(!state.methods.some(x=>x.includes('queue')||x.includes('turn/')));
  }finally{f.clean();}
});
test('delayed own listener retries only terminated read-only not-ready probes before one thread start',()=>{
  const f=fixture({notReady:2});try {
    const r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).mcp_verified,true);
    const state=JSON.parse(fs.readFileSync(f.state));assert.equal(state.attempts,4);assert.equal(state.methods.filter(x=>x==='thread/start').length,1);
  }finally{f.clean();}
});

test('Windows cold socket-unavailable retries before new or exact-resume mutation exactly once',()=>{
  for(const resume of [undefined,'11111111-1111-4111-8111-111111111111']) {
    const f=fixture({notReady:2,osError:10050,resume});try {
      const r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).mcp_verified,true);
      const state=JSON.parse(fs.readFileSync(f.state));assert.equal(state.attempts,resume?3:4);
      assert.equal(state.methods.filter(x=>x==='thread/start').length,resume?0:1);
      assert.equal(state.methods.filter(x=>x==='thread/resume').length,1);
      assert(!state.methods.some(x=>x.includes('queue')||x.includes('turn/')));
      const records=fs.readFileSync(path.join(f.directory,'readiness-attempts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(records.length,2);assert(records.every(r=>r.retryable&&r.acquisition_failures[0].kind==='socket-unavailable'&&r.acquisition_failures[0].os_code===10050));
    }finally{f.clean();}
  }
});

test('persistent Windows socket-unavailable exhausts budget before any claim, publication or thread RPC',()=>{
  const f=fixture({notReady:30,osError:10050});try {
    const r=f.run();assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).mcp_verified,undefined);
    const state=JSON.parse(fs.readFileSync(f.state));assert(state.attempts>1&&state.attempts<=20);assert.deepEqual(state.methods,[]);
    assert(!fs.existsSync(path.join(f.directory,'launch.initialize.claim')));assert(!fs.existsSync(path.join(f.directory,'launch.bound.message.json')));
    const records=fs.readFileSync(path.join(f.directory,'readiness-attempts.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.length,state.attempts);assert(records.every(r=>r.acquisition_failures[0].kind==='socket-unavailable'));
    const file=fs.readdirSync(f.directory).find(n=>n.startsWith('inspection-failure'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,file))).acquisition_failures[0].kind,'socket-unavailable');
  }finally{f.clean();}
});

test('post-check Windows socket-unavailable is one failed acquisition with no additional thread RPC',()=>{
  const f=fixture();try {
    assert.equal(f.run().status,0);
    const before=JSON.parse(fs.readFileSync(f.state)),control=path.join(f.directory,'control.json');
    fs.writeFileSync(control,JSON.stringify({...JSON.parse(fs.readFileSync(control)),failOnAttempts:[before.attempts+1],osError:10050}));
    const r=f.run('--check');assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).mcp_verified,undefined);
    const after=JSON.parse(fs.readFileSync(f.state));assert.equal(after.attempts,before.attempts+1);assert.deepEqual(after.methods,before.methods);
    assert(!fs.existsSync(path.join(f.directory,'readiness-attempts.jsonl')),'post-check never enters readiness retry');
  }finally{f.clean();}
});
test('CLI check resolves immutable bound publication without rewriting the original launch',()=>{
  const f=fixture();try {
    const original=path.join(f.directory,'launch.message.json'),before=fs.readFileSync(original);
    assert.equal(f.run().status,0);assert.deepEqual(fs.readFileSync(original),before);
    assert(fs.existsSync(path.join(f.directory,'launch.initialize.claim')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'launch.bound.message.json'))).cli_session,'11111111-1111-4111-8111-111111111111');
    const check=f.run('--check');assert.equal(check.status,0,check.stdout+check.stderr);assert.equal(JSON.parse(check.stdout).mcp_verified,true);
    const methods=JSON.parse(fs.readFileSync(f.state)).methods;
    fs.writeFileSync(original,JSON.stringify({...f.o,cli_session:'11111111-1111-4111-8111-111111111111'}));
    assert.equal(f.run('--check').status,1,'legacy helper rewrite must fail, not silently change original contract');
    assert.deepEqual(JSON.parse(fs.readFileSync(f.state)).methods,methods,'changed original fails before another RPC');
  }finally{f.clean();}
});
test('bound acquisition after thread mutation, incompatible version and access denial never retry',()=>{
  for(const extra of [{failOnAttempts:[2]},{failOnAttempts:[2],osError:10050},{badVersion:true},{notReady:1,osError:13}]) {
    const f=fixture(extra);try {
      const r=f.run();assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).mcp_verified,undefined);
      const state=JSON.parse(fs.readFileSync(f.state));assert.equal(state.attempts,extra.failOnAttempts?2:1);assert.equal(state.methods.filter(x=>x==='thread/start').length,extra.failOnAttempts?1:0);
    }finally{f.clean();}
  }
});
function notReady(code=1) {
  const e=new NativeConnectError('handshake','not-ready');Object.assign(e.diagnostic,{terminated:true,exit_code:code});
  return code===0?e:new AggregateError([e,new ProxyCleanupError('connect','nonzero',code)]);
}
test('finite readiness budget preserves classified attempts and no unknown/auth/protocol/cleanup retries',async()=>{
  let count=0;const records=[];
  await assert.rejects(waitNativeReady({}, {connect:async()=>{count++;throw notReady();},pause:async()=>{},now:()=>0,record:r=>records.push(r)}));
  assert.equal(count,20);assert.equal(records.length,20);assert(records.every(r=>r.retryable&&r.cleanup_failures[0].state==='nonzero'));
  for(const error of [new NativeConnectError('handshake','timeout'),new NativeConnectError('handshake','handshake-rejected'),new NativeConnectError('initialize','parser'),
    new NativeConnectError('version','mismatch'),new NativeConnectError('spawn','no-process',true),new Error('identity denied'),
    ...['pending','signal','thrown','unknown'].map(state=>new AggregateError([notReady(0),new ProxyCleanupError('connect',state)])),notReady(9)]) {
    let calls=0;await assert.rejects(waitNativeReady({}, {connect:async()=>{calls++;throw error;},pause:async()=>{},now:()=>0}));assert.equal(calls,1);
  }
  let attempts=0,clock=0;
  await assert.rejects(waitNativeReady({}, {connect:async()=>{attempts++;clock=5000;throw notReady();},pause:async()=>{},now:()=>clock}));assert.equal(attempts,1);
  let logging=0;
  await assert.rejects(waitNativeReady({}, {connect:async()=>{logging++;throw notReady();},record:()=>{throw Error('synthetic log write failure');},pause:async()=>{}}));assert.equal(logging,1);
});
test('owned process exit never promotes false/inaccessible filesystem stat to deletion proof',()=>{
  const record=ownedServerExit({socket:path.resolve('synthetic/protected/c.sock')},{pid:777},{code:0,signal:null});
  assert.equal(record.wrapperPid,process.pid);assert.equal(record.childPid,777);assert.equal(record.code,0);
  assert.equal(record.filesystemSocketState,'unverified');assert(!Object.hasOwn(record,'socketStillExists'));
});
