import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {EventEmitter} from 'node:events';
import {connectNative} from '../scripts/runtime/session-native.mjs';
import {inspectCodex} from '../scripts/runtime/session-codex.mjs';
function serverFrame(value) {
  const bytes=Buffer.from(value),header=Buffer.alloc(bytes.length<126?2:4);header[0]=0x81;
  if(header.length===2)header[1]=bytes.length;else {header[1]=126;header.writeUInt16BE(bytes.length,2);}
  return Buffer.concat([header,bytes]);
}
function clientMessage(bytes) {
  assert(bytes[1]&128,'client frames must be masked');let length=bytes[1]&127,offset=2;
  if(length===126){length=bytes.readUInt16BE(2);offset=4;}
  else if(length===127){length=Number(bytes.readBigUInt64BE(2));offset=10;}
  const mask=bytes.subarray(offset,offset+4),payload=Buffer.from(bytes.subarray(offset+4,offset+4+length));
  for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];return JSON.parse(payload.toString());
}
function fixture(failure,cleanup='normal',userAgent) {
  const state={spawns:0,ends:0,unrefs:0,destroys:0};
  const child=new EventEmitter();child.pid=failure==='spawn-async'?undefined:12345;
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
  child.stdout.destroy=child.stderr.destroy=child.stdin.destroy=()=>{state.destroys++;};
  child.unref=()=>{state.unrefs++;};child.kill=()=>{throw Error('forced stop forbidden');};
  const send=value=>queueMicrotask(()=>child.stdout.emit('data',value));
  function onRequest(bytes) {
    const message=clientMessage(bytes);if(message.method!=='initialize')return;
    if(failure==='initialize-timeout')return;
    if(failure==='parser-initialize')return send(serverFrame('RAW_SECRET_NOT_JSON'));
    const result=failure==='initialize-reject'?{error:{code:-32603,message:'RAW_SECRET_REMOTE'}}
      :{result:{userAgent:userAgent??(failure==='version'?'RAW_SECRET_VERSION':failure==='newer'?'codex/0.173.0':failure==='older'?'codex/0.171.9':'codex/0.172.0')}};
    send(serverFrame(JSON.stringify({id:message.id,...result})));
  }
  child.stdin.write=value=>{
    if(typeof value!=='string') {if(failure==='write-initialize')throw Error('RAW_SECRET_WRITE_INITIALIZE');onRequest(value);return true;}
    if(failure==='write')throw Error('RAW_SECRET_WRITE');
    if(failure==='spawn-async'||failure==='handshake-timeout')return true;
    if(failure==='handshake-reject') {send(Buffer.from('HTTP/1.1 403 RAW_SECRET_PROTOCOL\r\n\r\n'));return true;}
    const key=/Sec-WebSocket-Key: ([^\r]+)/.exec(value)[1];
    const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    let response=Buffer.from('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    if(failure==='parser-handshake')response=Buffer.concat([response,serverFrame('RAW_SECRET_NOT_JSON')]);
    send(response);return true;
  };
  child.stdin.end=()=>{state.ends++;if(cleanup==='thrown')throw Error('RAW_SECRET_CLEANUP');
    if(cleanup!=='pending')queueMicrotask(()=>child.emit('exit',cleanup==='nonzero'?9:cleanup==='signal'?null:0,cleanup==='signal'?'SIGTERM':null));};
  const dependencies={setTimeout:(fn,ms)=>setTimeout(fn,ms===3000?5:15),spawn:()=>{
    state.spawns++;if(failure==='spawn-sync')throw Error('RAW_SECRET_SPAWN');
    if(failure==='spawn-async')queueMicrotask(()=>child.emit('error',Error('RAW_SECRET_SPAWN')));
    else queueMicrotask(()=>child.stderr.emit('data',Buffer.from('RAW_SECRET_STDERR')));
    return child;
  }};
  return {state,dependencies};
}
const options={executable:'synthetic-native',cwd:process.cwd(),socket:path.resolve('synthetic/native.sock'),env:{SYNTHETIC_SECRET:'RAW_SECRET_ENV'}};
async function inspect(failure,cleanup) {
  const f=fixture(failure,cleanup),directory=fs.mkdtempSync(path.join(os.tmpdir(),'native-acquire-'));
  try {
    const outcome=await inspectCodex({directory},{},'--check',()=>connectNative(options,f.dependencies));
    const filename=fs.readdirSync(directory).find(n=>n.startsWith('inspection-failure'));
    assert(filename);const raw=fs.readFileSync(path.join(directory,filename),'utf8');
    assert(!raw.includes('RAW_SECRET'));assert(!JSON.stringify(outcome).includes('RAW_SECRET'));
    assert.equal(outcome.code,1);assert.equal(outcome.result.mcp_verified,undefined);assert.equal(outcome.result.cmd,undefined);
    return {record:JSON.parse(raw),state:f.state};
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
}
test('RED acquisition failure preserves pending proxy cleanup in inspection evidence',async()=>{
  const {record}=await inspect('handshake-reject','pending');
  assert.equal(record.cleanup_failures.length,1,'factory failure must propagate its pending cleanup');
  assert.equal(record.cleanup_failures[0].state,'pending');
});
test('handshake/parser/initialize/version/write failures retain primary and classified cleanup once',async()=>{
  for(const failure of ['handshake-reject','handshake-timeout','parser-handshake','parser-initialize','initialize-reject','initialize-timeout','version','write','write-initialize'])
    for(const cleanup of ['normal','pending','nonzero','signal','thrown']) {
      const {record,state}=await inspect(failure,cleanup);
      assert.equal(record.verification_failed,true,failure);assert.equal(record.acquisition_failures.length,1,failure);
      const expected={
        'handshake-reject':['handshake','handshake-rejected'],'handshake-timeout':['handshake','timeout'],
        'parser-handshake':['handshake','parser'],'parser-initialize':['initialize','parser'],
        'initialize-reject':['initialize','rejected'],'initialize-timeout':['initialize','timeout'],version:['version','mismatch'],write:['handshake','write-failed'],'write-initialize':['initialize','rejected'],
      }[failure];
      assert.deepEqual([record.acquisition_failures[0].phase,record.acquisition_failures[0].kind],expected,failure);
      assert.equal(record.acquisition_failures[0].no_process,false);
      assert.equal(record.cleanup_failures.length,cleanup==='normal'?0:1,failure+' '+cleanup);
      if(cleanup!=='normal')assert.equal(record.cleanup_failures[0].state,cleanup);
      assert.equal(state.ends,1,'normal stream close must be once-only');assert.equal(state.spawns,1,'no retry');assert.equal(state.unrefs,1);
    }
});
test('spawn failures explicitly report no process rather than a fabricated pending exit',async()=>{
  for(const failure of ['spawn-sync','spawn-async']) {
    const {record,state}=await inspect(failure,'pending');
    assert.equal(record.acquisition_failures[0].phase,'spawn');assert.equal(record.acquisition_failures[0].no_process,true);
    assert.equal(record.cleanup_failures.length,0);assert.equal(state.spawns,1);assert.equal(state.ends,0);
  }
});
test('bound factory acquisition failure preserves cleanup after the initial bootstrap already closed',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bound-native-acquire-'));
  const f=fixture('initialize-reject','pending');let opened=0,closed=0;
  const id='11111111-1111-4111-8111-111111111111';
  const o={directory,role:'work',model:'gpt-6.1-sol',cwd:process.cwd()};
  fs.writeFileSync(path.join(directory,'launch.message.json'),JSON.stringify(o));
  const initial={close:async()=>{closed++;return {exit:{code:0}};},request:async()=>({thread:{id},model:o.model,cwd:o.cwd,approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:{type:'dangerFullAccess'}})};
  try {
    const out=await inspectCodex(o,{request:{config:{'mcp_servers.ai_settings_sessions':{env:{}}}}},'--initialize',async()=>++opened===1?initial:connectNative(options,f.dependencies));
    assert.equal(out.code,1);assert.equal(out.result.mcp_verified,undefined);assert.equal(closed,1);assert.equal(opened,2);
    const file=fs.readdirSync(directory).find(n=>n.startsWith('inspection-failure'));
    const record=JSON.parse(fs.readFileSync(path.join(directory,file),'utf8'));
    assert.equal(record.acquisition_failures[0].phase,'initialize');assert.equal(record.cleanup_failures[0].state,'pending');
    assert.equal(f.state.ends,1);assert.equal(f.state.spawns,1);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
test('native handshake accepts newer Codex with its real version and rejects older',async()=>{
  const f=fixture('newer'),client=await connectNative(options,f.dependencies);
  assert.equal(client.version,'0.173.0');await client.close();
  await assert.rejects(connectNative(options,fixture('older').dependencies),e=>e.diagnostic?.phase==='version');
});
test('normal native handshake/initialize and once-only close keep the protocol unchanged',async()=>{
  const f=fixture('normal'),client=await connectNative(options,f.dependencies);
  assert.equal(client.version,'0.172.0');const a=client.close(),b=client.close();assert.equal(a,b);
  assert.deepEqual((await a).exit,{code:0,signal:null});assert.equal(f.state.ends,1);assert.equal(f.state.unrefs,1);
});

test('native version accepts the actual client product and preserves version rejection',async()=>{
  for(const [userAgent,version] of [
    ['ai-settings-host-capability/0.172.0','0.172.0'],
    ['ai-settings-host-capability/0.172.0 (Windows 10.0; x86_64)','0.172.0'],
    ['ai-settings-host-capability/0.173.0','0.173.0'],
    ['codex-tui/0.172.0','0.172.0'],
  ]) {
    const f=fixture('normal','normal',userAgent),client=await connectNative(options,f.dependencies);
    try {assert.equal(client.version,version);}finally{await client.close();}
    assert.equal(f.state.ends,1);
  }
  for(const userAgent of ['ai-settings-host-capability/0.171.9','ai-settings-host-capability/garbage',
    'unexpected/0.172.0','unexpected-codex/0.172.0','prefix ai-settings-host-capability/0.172.0']) {
    const f=fixture('normal','normal',userAgent);
    await assert.rejects(connectNative(options,f.dependencies),e=>e.diagnostic?.phase==='version');
    assert.equal(f.state.ends,1);
  }
});
