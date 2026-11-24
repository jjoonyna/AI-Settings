import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {connectNative,waitNativeReady,NativeConnectError,ProxyCleanupError} from '../scripts/runtime/session-native.mjs';
import {inspectionConnector} from '../scripts/runtime/session-codex.mjs';
const socket=path.resolve('synthetic/owned/c.sock');
const stderr='Error: failed to connect to socket at '+socket+'\n\nCaused by:\n    The network subsystem is unavailable. (os error 10050)\n';
// Synthetic localized OS description, not captured native stderr or provider proof.
const koreanCause='네트워크 하위 시스템을 현재 사용할 수 없습니다.';
const localized=stderr.replace('The network subsystem is unavailable.',koreanCause);
const options={executable:'synthetic-native',socket,cwd:process.cwd(),env:{}};
function fixture(change={}) {
  let calls=0,ends=0;
  const child=new EventEmitter();child.pid=12345;
  for(const key of ['stdin','stdout','stderr']){child[key]=new EventEmitter();child[key].destroy=()=>{};}
  child.stderr.readableEnded=false;
  child.unref=()=>{if(change.cleanupThrown)throw Error('private cleanup text');};
  child.stdin.end=()=>{ends++;};
  child.stdin.write=()=>{
    queueMicrotask(()=>{
      if(change.stdout)child.stdout.emit('data',Buffer.from(change.stdout));
      child.stderr.emit('data',change.stderr??Buffer.from(stderr));
      if(!change.partial){child.stderr.readableEnded=true;child.stderr.emit('end');}
      if(change.pending)child.stdin.emit('error',Error('private stdio text'));
      else child.emit('exit',change.code===undefined?1:change.code,change.signal===undefined?null:change.signal);
    });return true;
  };
  const dependencies={platform:change.platform??'win32',spawn:()=>{calls++;return child;},setTimeout:(fn)=>setTimeout(fn,5)};
  return {dependencies,get calls(){return calls;},get ends(){return ends;}};
}
async function failure(change={}) {
  const f=fixture(change),records=[];let error,clock=0;
  try {await waitNativeReady(options,{connect:()=>connectNative(options,f.dependencies),now:()=>clock++===0?0:5000,pause:async()=>{},record:r=>records.push(r)});}
  catch(e){error=e;}
  assert(error);assert.equal(f.ends,1);assert.equal(f.calls,1);
  assert(!JSON.stringify(records).includes('private'));assert(!JSON.stringify(records).includes('network subsystem'));
  return records[0];
}
test('RED complete exact own Windows OS10050 is distinct socket-unavailable with terminated cleanup evidence',async()=>{
  const record=await failure();assert.equal(record.retryable,true);
  assert.deepEqual(record.acquisition_failures,[{phase:'handshake',kind:'socket-unavailable',no_process:false,os_code:10050,terminated:true,exit_code:1}]);
  assert.deepEqual(record.cleanup_failures,[{proxy:'connect',state:'nonzero',code:1}]);assert.equal(record.unknown,false);
  assert.equal((await failure({stderr:Buffer.from(stderr.replaceAll('\n','\r\n'))})).retryable,true);
});

test('RED localized Korean Windows single cause retains the same strict typed acquisition evidence',async()=>{
  for(const text of [localized,localized.replaceAll('\n','\r\n'),localized.replace(koreanCause,'Réseau indisponible, e\u0301chec (réseau).')]) {
    const r=await failure({stderr:Buffer.from(text)});assert.equal(r.retryable,true);
    assert.equal(r.acquisition_failures[0].kind,'socket-unavailable');assert.equal(r.acquisition_failures[0].os_code,10050);
    assert(!JSON.stringify(r).includes(koreanCause));
  }
});

test('localized cause refuses controls, Unicode separators/bidi, extra OS tokens/causes/output and malformed UTF8',async()=>{
  const texts=[
    ...['\0','\t','\r','\n','\u0085','\u2028','\u2029','\u202a','\u202e','\u2066','\u2069','\u200e','\u200f'].map(c=>localized.replace(koreanCause,'네트워크'+c+'사용 불가.')),
    localized.replace(koreanCause,koreanCause+' (os error 10050)'),
    localized.replace(koreanCause,koreanCause+' (os error 13)'),
    localized.replace(koreanCause,koreanCause+' os error 10050'),
    localized.replace(koreanCause,koreanCause+' Caused by: 네트워크.'),
    localized.replace(koreanCause,'0: '+koreanCause),
    '\uFEFF'+localized,localized+'추가 출력\n',localized.replace('    '+koreanCause,'   '+koreanCause),
    localized.replace('10050','10013'),localized.replace(socket,socket+'-other'),
    localized.replace(koreanCause,'Permission denied. '+koreanCause),
    localized.replace(koreanCause,'Authentication failed. '+koreanCause),
    localized.replace(koreanCause,'Configuration error. '+koreanCause),
    localized.replace(koreanCause,'Protocol error. '+koreanCause),
  ];
  for(const text of texts){const r=await failure({stderr:Buffer.from(text)});assert.equal(r.retryable,false);assert.notEqual(r.acquisition_failures[0].kind,'socket-unavailable');}
  const broken=Buffer.concat([Buffer.from(localized.slice(0,localized.indexOf(koreanCause))),Buffer.from([0xc3,0x28]),Buffer.from(localized.slice(localized.indexOf(koreanCause)))]);
  assert.equal((await failure({stderr:broken})).retryable,false);
  for(const change of [{partial:true},{stdout:'H'},{platform:'linux'},{pending:true},{signal:'SIGTERM'},{code:9},{cleanupThrown:true}])
    assert.equal((await failure({...change,stderr:Buffer.from(localized)})).retryable,false);
});
test('socket-unavailable rejects malformed, extra, other endpoint/OS, partial/overflow, protocol and unsupported-platform evidence',async()=>{
  const changes=[
    {stderr:Buffer.from(stderr.replace(socket,socket+'-other'))},
    ...[2,13,10013,10061,10051].map(code=>({stderr:Buffer.from(stderr.replace('10050',String(code)))})),
    ...['warning\n'+stderr,stderr+'extra\n',stderr+'\n',stderr.replace('\n\nCaused by:','\nCaused by:'),
      stderr.replace('    The','    0: The'),stderr.replace('10050','10050) (os error 10050'),
      stderr.replace('The network subsystem is unavailable.','Permission denied.'),
      stderr.replace('The network subsystem is unavailable.','Authentication failed.'),
      stderr.replace('The network subsystem is unavailable.','Configuration error.'),
      stderr.replace('The network subsystem is unavailable.','Protocol error.')].map(s=>({stderr:Buffer.from(s)})),
    {stderr:Buffer.concat([Buffer.from(stderr),Buffer.from([255])])},
    {stderr:Buffer.from(stderr+'x'.repeat(8193))},{partial:true},{stdout:'H'},{stdout:'HTTP/1.1 403 Denied\r\n\r\n'},
    {platform:'linux'},{platform:'darwin'},
  ];
  for(const change of changes){const r=await failure(change);assert.notEqual(r.acquisition_failures[0].kind,'socket-unavailable',JSON.stringify(change));
    // The old known-listener class remains permitted, including OS2 and OS10061.
    assert.equal(r.retryable,[2,10061].some(code=>change.stderr?.toString()===stderr.replace('10050',String(code))));}
});
test('socket-unavailable never retries pending, signal, abnormal/unknown exit or thrown cleanup',async()=>{
  for(const change of [{pending:true},{signal:'SIGTERM'},{code:null},{code:0},{code:9},{cleanupThrown:true}]) {
    const r=await failure(change);assert.equal(r.retryable,false);assert.notEqual(r.acquisition_failures[0].kind,'socket-unavailable');
  }
});
test('typed Windows socket-unavailable budget is finite and requires complete classified exit evidence',async()=>{
  const primary=new NativeConnectError('handshake','socket-unavailable');Object.assign(primary.diagnostic,{os_code:10050,terminated:true,exit_code:1});
  const error=new AggregateError([primary,new ProxyCleanupError('connect','nonzero',1)]);
  let calls=0;const records=[];
  await assert.rejects(waitNativeReady(options,{connect:async()=>{calls++;throw error;},now:()=>0,pause:async()=>{},record:r=>records.push(r)}));
  assert.equal(calls,20);assert.equal(records.length,20);assert(records.every(r=>r.retryable&&r.acquisition_failures[0].os_code===10050));
  for(const incomplete of [primary,new AggregateError([primary,new ProxyCleanupError('other','nonzero',1)]),new AggregateError([error,Error('unknown failure')])]) {
    let attempts=0;await assert.rejects(waitNativeReady(options,{connect:async()=>{attempts++;throw incomplete;},now:()=>0,pause:async()=>{}}));assert.equal(attempts,1);
  }
  let attempts=0,clock=0;
  await assert.rejects(waitNativeReady(options,{connect:async()=>{attempts++;clock=5000;throw error;},now:()=>clock,pause:async()=>{}}));assert.equal(attempts,1);
  attempts=0;clock=0;
  await assert.rejects(waitNativeReady(options,{connect:async()=>{attempts++;throw error;},now:()=>clock,pause:async()=>{clock=5001;}}));
  assert.equal(attempts,1,'a delayed pause cannot start another acquisition past the between-attempt deadline');
});
test('initial new and selected launch wait only before acquisition; bound, check and unknown mutation outcomes never retry',async()=>{
  for(const resume of [undefined,'11111111-1111-4111-8111-111111111111']) {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'readiness-boundary-'));
    try {
      let calls=0,mutations=0;
      const client={request:async()=>{mutations++;throw Error('unknown mutation outcome');}};
      const f=fixture();
      const connector=inspectionConnector({...options,directory,resume},'--initialize',{connect:async()=>{
        calls++;if(calls===1)return connectNative(options,f.dependencies);if(calls===2)return client;throw Error('bound acquisition failed');
      },pause:async()=>{}});
      const acquired=await connector();assert.equal(calls,2);
      await assert.rejects(acquired.request('thread/start',{}));assert.equal(mutations,1);assert.equal(calls,2);
      await assert.rejects(connector());assert.equal(calls,3,'bound acquisition is single attempt');
      let checkCalls=0;const check=inspectionConnector({...options,directory,resume},'--check',{connect:async()=>{checkCalls++;throw Error('check failed');}});
      await assert.rejects(check());assert.equal(checkCalls,1);
    }finally{fs.rmSync(directory,{recursive:true,force:true});}
  }
});
