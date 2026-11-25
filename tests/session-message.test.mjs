import test from 'node:test';
import assert from 'node:assert/strict';
import {deliver} from '../scripts/runtime/session-message.mjs';
import {childEnvironment} from '../scripts/runtime/session-message-rpc.mjs';
import {messageRpc} from '../scripts/runtime/session-message-rpc.mjs';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const id='11111111-1111-4111-8111-111111111111';
const input={identity:{cli_session:id},message_id:'message-1',operation:'message',text:'preserve existing draft'};
function fake(response,fail=false) {
  const calls=[];return {calls,rpc:()=>({request:async r=>({ok:true,operation:'message',cli_session:id,endpoint:'unix://'+path.resolve('synthetic/control.sock').replaceAll('\\','/'),executable:path.resolve('synthetic/codex.exe'),cwd:process.cwd(),body_hash:r.body_hash}),close(){}}),
    open:async()=>({request:async(method,params)=>{calls.push({method,params});if(fail)throw Error('SECRET_DO_NOT_EMIT');return response;},close(){}})};
}
test('queue receipt is accepted once without turn/start, Enter or execution claim',async()=>{
  const f=fake({queuedSubmission:{id:'receipt-1',clientUserMessageId:'message-1',input:[{type:'text',text:input.text}]}});
  const r=await deliver(input,f);assert.equal(r.state,'accepted');assert.equal(r.execution,'not_observed');assert.equal(r.receipt,'receipt-1');
  assert.deepEqual(f.calls,[{method:'thread/queue/add',params:{threadId:id,clientUserMessageId:'message-1',input:[{type:'text',text:input.text}]}}]);
});
test('post-claim loss is unknown, executes at most once and redacts raw errors',async()=>{
  const f=fake(null,true),r=await deliver(input,f);assert.equal(r.state,'unknown');assert.equal(f.calls.length,1);assert(!JSON.stringify(r).includes('SECRET'));
});
test('wrong live CLI/operation cannot send and child RPC never inherits inbox credentials',async()=>{
  const f=fake({});f.rpc=()=>({request:async()=>({ok:true,cli_session:'wrong'}),close(){}});
  assert.equal((await deliver(input,f)).state,'failed');assert.equal(f.calls.length,0);
  const e=childEnvironment({NVIM:'synthetic',CLAUDE_CODE_MESSAGING_TOKEN:'SECRET',CLAUDE_CODE_MESSAGING_SOCKET:'SECRET_PIPE',CLAUDE_CODE_SESSION_ID:'old'});
  assert.deepEqual(e,{NVIM:'synthetic'});
});
test('real persistent Neovim adapter checks live identity and atomically consumes a message once',async()=>{
  const server=process.platform==='win32'?'\\\\.\\pipe\\message-test-'+crypto.randomUUID():path.join(os.tmpdir(),'message-'+crypto.randomUUID()+'.sock');
  const child=spawn('nvim',['--headless','-u','NONE','-i','NONE','--listen',server,'-l','nvim/tests/agent-hub/message-server.lua'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  const closed=new Promise(resolve=>child.once('exit',resolve));child.stderr.on('data',()=>{});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('fixture startup timeout')),5000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
  const rpc=messageRpc({...process.env,NVIM:server});
  const identity={instance:'message-test',owner:1,task_id:'task',vendor:'codex',cli_session:id,token:'synthetic'};
  try {
    assert.equal((await rpc.request({operation:'ready',identity,role:'work',model:'gpt-6.1-sol'})).ok,true);
    const packet={operation:'authorize',identity,message_id:'exact-message',body_hash:crypto.createHash('sha256').update('body').digest('hex')};
    assert.equal((await rpc.request({...packet,identity:{...identity,task_id:'wrong'}})).ok,false);
    const bound=await rpc.request(packet);assert.equal(bound.ok,true);assert.equal(bound.cli_session,id);assert(!JSON.stringify(bound).includes('synthetic-token'));
    assert.equal((await rpc.request(packet)).ok,false);
    assert.equal((await rpc.request({operation:'end',identity})).ok,true);
  } finally {rpc.close();await closed;}
});
