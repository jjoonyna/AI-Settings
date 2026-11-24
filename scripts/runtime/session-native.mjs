// Explicit private native connection. No default/shared daemon or process kill.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {frame,Frames} from './app-proxy.mjs';
export class ProxyCleanupError extends Error {
  constructor(proxy,state,code) {
    super(`MCP ${proxy} proxy close incomplete`);
    this.diagnostic={proxy,state,...(Number.isSafeInteger(code)?{code}:{})};
  }
}
export class NativeConnectError extends Error {
  constructor(phase,kind,no_process=false) {
    super('Native proxy acquisition failed; raw diagnostics omitted');
    this.diagnostic={phase,kind,no_process};
    if(kind==='timeout')this.code='ETIMEDOUT';
  }
}
export function verifyProxyCleanup(cleanup,label) {
  const exit=cleanup?.exit;
  if(exit?.pending===true)throw new ProxyCleanupError(label,'pending',exit.code);
  if(exit?.signal!==undefined&&exit.signal!==null)throw new ProxyCleanupError(label,'signal',exit.code);
  if(exit?.code!==0||(exit.pending!==undefined&&exit.pending!==false))
    throw new ProxyCleanupError(label,Number.isSafeInteger(exit?.code)&&exit.code!==0?'nonzero':'unknown',exit?.code);
  return cleanup;
}
function missingListener(stderr,socket) {
  const text=stderr.toString('utf8').replaceAll('\r\n','\n').trim(),prefix='Error: failed to connect to socket at ';
  const at=text.indexOf('\n');
  return at>0&&text.startsWith(prefix)&&text.slice(prefix.length,at).replaceAll('\\','/')===socket.replaceAll('\\','/')
    &&/^Caused by:\n[ \t]+[^\r\n]*\(os error (?:2|3|61|111|10061)\)$/.test(text.slice(at+1).trim());
}
function windowsSocketUnavailable(stderr,socket,platform) {
  if(platform!=='win32')return false;
  let text;
  try {text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(stderr).replaceAll('\r\n','\n');}catch{return false;}
  const lines=text.replace(/\n$/,'').split('\n'),prefix='Error: failed to connect to socket at ';
  const cause=/^    (\p{L}[\p{L}\p{M}\p{N}\p{P}\p{Zs}]*) \(os error 10050\)$/u.exec(lines[3]||'')?.[1];
  return lines.length===4&&lines[0].startsWith(prefix)
    &&lines[0].slice(prefix.length).replaceAll('\\','/')===socket.replaceAll('\\','/')
    &&lines[1]===''&&lines[2]==='Caused by:'
    &&cause!==undefined&&!/(?:permission|denied|auth|config|protocol|os error|Caused by:)/i.test(cause);
}
function failureDetails(error) {
  const acquisition_failures=[],cleanup_failures=[],seen=new Set();let unknown=false;
  function visit(value) {
    if(seen.has(value))return;seen.add(value);
    if(value instanceof NativeConnectError)acquisition_failures.push(value.diagnostic);
    else if(value instanceof ProxyCleanupError)cleanup_failures.push(value.diagnostic);
    else if(value instanceof AggregateError)value.errors.forEach(visit);
    else unknown=true;
  }
  visit(error);return {acquisition_failures,cleanup_failures,unknown};
}
export async function waitNativeReady(options,dependencies={}) {
  const connect=dependencies.connect||connectNative,pause=dependencies.pause||(ms=>new Promise(resolve=>setTimeout(resolve,ms))),now=dependencies.now||Date.now;
  const deadline=now()+5000; // Between-attempt deadline; each acquisition retains its own handshake/cleanup timeouts.
  for(let attempt=1;attempt<=20;attempt++) {
    try {return await connect(options);}catch(error){
      const details=failureDetails(error),p=details.acquisition_failures[0];
      const retryable=!details.unknown&&details.acquisition_failures.length===1&&p.phase==='handshake'
        &&((p.kind==='not-ready'&&(p.exit_code===0||p.exit_code===1))
          ||(p.kind==='socket-unavailable'&&p.os_code===10050&&p.exit_code===1
            &&details.cleanup_failures.length===1&&details.cleanup_failures[0].proxy==='connect'))
        &&p.terminated===true
        &&details.cleanup_failures.every(c=>c.state==='nonzero'&&c.code===1);
      try {dependencies.record?.({attempt,retryable,...details});}
      catch {throw new AggregateError([error,new Error('Readiness evidence unavailable')],'Native readiness failed');}
      if(!retryable||attempt===20||now()>=deadline)throw error;
      await pause(Math.min(100,Math.max(0,deadline-now())));
      if(now()>=deadline)throw error;
    }
  }
}
export async function connectNative(options,dependencies={}) {
  const schedule=dependencies.setTimeout||setTimeout;
  let child;
  try {child=(dependencies.spawn||spawn)(options.executable,['app-server','proxy','--sock',options.socket],{cwd:options.cwd,env:options.env,windowsHide:true,stdio:['pipe','pipe','pipe']});}
  catch {throw new NativeConnectError('spawn','no-process',true);}
  let header=Buffer.alloc(0),ready=false,closed=false,seq=0,stderrBytes=0,totalBytes=0,notificationCount=0;
  let phase='handshake',firstFailure,spawnFailed=false,closePromise;
  let stderrCapture=Buffer.alloc(0),stderrOverflow=false,stderrComplete=false;
  const pending=new Map();
  let resolveHandshake,rejectHandshake;
  const handshake=new Promise((resolve,reject)=>{resolveHandshake=resolve;rejectHandshake=reject;});
  // A synchronous initial write may fail before the handshake await is reached.
  handshake.catch(()=>{});
  let exitResult;
  let resolveExit;
  const exited=new Promise(resolve=>{resolveExit=resolve;child.once('exit',(code,signal)=>{exitResult={code,signal};resolve(exitResult);});});
  function fail(e){if(closed)return;closed=true;firstFailure=e;rejectHandshake(e);for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();}
  child.on('error',()=>{
    if(!child.pid){spawnFailed=true;exitResult={noProcess:true};resolveExit(exitResult);firstFailure=new NativeConnectError('spawn','no-process',true);}
    fail(firstFailure||new NativeConnectError(phase,'process-error'));
  });
  child.on('exit',()=>fail(new NativeConnectError(phase,'proxy-exited')));
  child.stdin.on('error',()=>fail(new NativeConnectError(phase,'stdio-error')));
  child.stderr.on('data',b=>{
    stderrBytes+=b.length;
    if(phase==='handshake'&&!stderrOverflow) {
      if(stderrCapture.length+b.length<=8192)stderrCapture=Buffer.concat([stderrCapture,b]);else stderrOverflow=true;
    }
  });
  const stderrEnded=new Promise(resolve=>{
    child.stderr.once('end',()=>{stderrComplete=true;resolve(true);});
    child.stderr.once('close',()=>resolve(child.stderr.readableEnded===true));
  });
  const parser=new Frames(bytes=>{
    const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(pending.has(m.id)) {
      const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);
      m.error?p.reject(Object.assign(new Error('RPC rejected; raw message omitted'),{code:m.error.code})):p.resolve(m.result);
    } else if(m.id!==undefined&&m.method)throw new Error('unexpected server request; no automatic approval');
    else if(['turn/started','turn/completed','item/completed'].includes(m.method)&&m.params?.threadId===options.threadId) {
      assert(++notificationCount<=64,'notification limit exceeded');
      const n=m.params;
      options.onNotification?.({method:m.method,threadId:n.threadId,turnId:n.turn?.id??n.turnId??null,status:n.turn?.status??null,
        agentAckExact:n.item?.type==='agentMessage'?n.item.text===options.ack:null});
    }
  },(op,data)=>{if(op===9&&!closed)child.stdin.write(frame(data,10));if(op===8)fail(new NativeConnectError(phase,'peer-closed'));});
  const key=crypto.randomBytes(16).toString('base64');
  const expectedAccept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  child.stdout.on('data',chunk=>{try{
    totalBytes+=chunk.length;assert(totalBytes<=1024*1024,'diagnostic wire limit exceeded');
    if(!ready) {
      header=Buffer.concat([header,chunk]);assert(header.length<=16384,'upgrade header too large');
      const end=header.indexOf('\r\n\r\n');if(end<0)return;
      const lines=header.subarray(0,end).toString('ascii').split('\r\n');
      const headers=Object.fromEntries(lines.slice(1).map(l=>{const i=l.indexOf(':');return [l.slice(0,i).trim().toLowerCase(),l.slice(i+1).trim()];}));
      assert(/^HTTP\/1\.[01] 101(?: |$)/.test(lines[0]),'upgrade rejected');
      assert.equal(headers['sec-websocket-accept'],expectedAccept,'upgrade signature mismatch');
      assert(/^websocket$/i.test(headers.upgrade||''),'upgrade protocol mismatch');
      assert(/(?:^|,)\s*upgrade\s*(?:,|$)/i.test(headers.connection||''),'upgrade connection mismatch');
      ready=true;resolveHandshake();chunk=header.subarray(end+4);header=Buffer.alloc(0);
    }
    parser.push(chunk);
  }catch{fail(new NativeConnectError(phase,ready?'parser':'handshake-rejected'));}});
  function close() {
    if(!closePromise)closePromise=(async()=>{
      let exit,timer,cleanupThrew=false;const deadline=Date.now()+3000;
      if(spawnFailed&&!child.pid)exit={noProcess:true};
      else {
        try {child.stdin.end();}catch{cleanupThrew=true;}
        try {exit=exitResult||await Promise.race([exited,new Promise(resolve=>{timer=schedule(()=>resolve({pending:true}),3000);})]);}
        catch {cleanupThrew=true;}
        finally {clearTimeout(timer);}
      }
      if(phase==='handshake'&&totalBytes===0&&!exit?.noProcess&&Number.isSafeInteger(exit?.code)&&typeof child.stderr.readableEnded==='boolean') {
        try {stderrComplete=child.stderr.readableEnded||await Promise.race([stderrEnded,new Promise(resolve=>{timer=schedule(()=>resolve(false),Math.max(0,deadline-Date.now()));})]);}
        catch {cleanupThrew=true;}
        finally {clearTimeout(timer);}
      }
      for(const release of [()=>{if(exit?.noProcess)child.stdin.destroy();},()=>child.stdout.destroy(),()=>child.stderr.destroy(),()=>child.unref()])
        try {release();}catch{cleanupThrew=true;}
      if(cleanupThrew)throw new ProxyCleanupError('connect','thrown',exit?.code);
      return {exit,stderrBytes};
    })();
    return closePromise;
  }
  function request(method,params){
    assert(['initialize','thread/start','thread/resume','thread/read','mcpServerStatus/list','thread/name/set','thread/queue/add'].includes(method),'unsupported native operation');assert(pending.size<2,'pending request limit');
    return new Promise((resolve,reject)=>{
      if(closed)return reject(new Error('proxy closed'));
      const id=++seq,timer=schedule(()=>{pending.delete(id);reject(Object.assign(new Error('request timeout'),{code:'ETIMEDOUT'}));},15000);
      pending.set(id,{resolve,reject,timer});child.stdin.write(frame(JSON.stringify({id,method,params})));
    });
  }
  let timer;
  try {
    timer=schedule(()=>fail(new NativeConnectError('handshake','timeout')),12000);
    child.stdin.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    await handshake;clearTimeout(timer);if(firstFailure)throw firstFailure;
    phase='initialize';
    const init=await request('initialize',{clientInfo:{name:'ai-settings-host-capability',version:'0.1.0'},capabilities:{experimentalApi:true}});
    phase='version';
    assert(/\/0\.172\.0(?:\s|$)/.test(init?.userAgent||''),'unexpected server version');
    phase='initialize';
    child.stdin.write(frame(JSON.stringify({method:'initialized',params:{}})));
    phase='ready';
    return {request,close,version:'0.172.0'};
  } catch(error) {
    let primary=firstFailure||(error instanceof NativeConnectError?error:new NativeConnectError(phase,
      phase==='version'?'mismatch':error?.code==='ETIMEDOUT'?'timeout':phase==='handshake'?'write-failed':'rejected'));
    fail(primary); // Also clear pending RPC timers when a synchronous write/assertion caused the failure.
    try {
      const cleanup=await close();
      if(cleanup.exit?.noProcess===true)primary=new NativeConnectError('spawn','no-process',true);
      else {
        if(primary.diagnostic.phase==='handshake'&&['proxy-exited','stdio-error'].includes(primary.diagnostic.kind)
          &&totalBytes===0&&!stderrOverflow&&stderrComplete) {
          if(missingListener(stderrCapture,options.socket)) {
            primary=new NativeConnectError('handshake','not-ready');
            primary.diagnostic.terminated=Number.isSafeInteger(cleanup.exit?.code)&&cleanup.exit?.signal==null&&!cleanup.exit?.pending;
            if(Number.isSafeInteger(cleanup.exit?.code))primary.diagnostic.exit_code=cleanup.exit.code;
          }else if(cleanup.exit?.code===1&&cleanup.exit.signal===null&&!cleanup.exit.pending
            &&windowsSocketUnavailable(stderrCapture,options.socket,dependencies.platform??process.platform)) {
            primary=new NativeConnectError('handshake','socket-unavailable');
            Object.assign(primary.diagnostic,{os_code:10050,terminated:true,exit_code:1});
          }
        }
        verifyProxyCleanup(cleanup,'connect');
      }
    }catch(cleanupError){
      const classified=cleanupError instanceof ProxyCleanupError?cleanupError:new ProxyCleanupError('connect','thrown');
      throw new AggregateError([primary,classified],'Native acquisition and proxy cleanup failed; raw diagnostics omitted');
    }
    throw primary;
  } finally {clearTimeout(timer);stderrCapture.fill(0);stderrCapture=Buffer.alloc(0);}
}
