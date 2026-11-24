import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {messageRpc,childEnvironment} from './session-message-rpc.mjs';
import {connectNative} from './session-native.mjs';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export async function deliver(input,dependencies={}) {
  let rpc,client,claimed=false;
  try {
    assert(input&&typeof input.text==='string'&&Buffer.byteLength(input.text)>0&&Buffer.byteLength(input.text)<=256*1024);
    assert(['message','name'].includes(input.operation)&&uuid.test(input.identity?.cli_session||''));
    rpc=(dependencies.rpc||messageRpc)();
    const body_hash=crypto.createHash('sha256').update(input.text).digest('hex');
    const binding=await rpc.request({operation:'authorize',identity:input.identity,message_id:input.message_id,body_hash});
    assert(binding?.ok&&binding.operation===input.operation&&binding.cli_session===input.identity.cli_session&&binding.body_hash===body_hash);
    claimed=true;
    assert(typeof binding.endpoint==='string'&&binding.endpoint.startsWith('unix://'));
    assert(path.isAbsolute(binding.endpoint.slice(7)));
    assert(typeof binding.executable==='string'&&path.isAbsolute(binding.executable));
    client=await (dependencies.open||connectNative)({executable:binding.executable,cwd:binding.cwd,socket:binding.endpoint.slice(7),env:childEnvironment(process.env)});
    if(input.operation==='name') {
      assert(input.text.length<=512&&!/[\x00-\x1f]/.test(input.text));
      await client.request('thread/name/set',{threadId:binding.cli_session,name:input.text});
      return {state:'accepted',stage:'metadata',execution:'not_applicable'};
    }
    const response=await client.request('thread/queue/add',{threadId:binding.cli_session,clientUserMessageId:input.message_id,input:[{type:'text',text:input.text}]});
    const q=response?.queuedSubmission;
    assert(typeof q?.id==='string'&&/^[a-zA-Z0-9_:-]{1,128}$/.test(q.id)&&q.clientUserMessageId===input.message_id);
    assert(Array.isArray(q.input)&&q.input.length===1&&q.input[0].type==='text'&&q.input[0].text===input.text);
    return {state:'accepted',stage:'vendor-queue',receipt:q.id,execution:'not_observed'};
  } catch { return {state:claimed?'unknown':'failed',detail:'identity/transport response unavailable; no redelivery',execution:'not_observed'}; }
  finally {if(client)try{await client.close();}catch{}if(rpc)try{rpc.close();}catch{}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let raw='';try{for await(const chunk of process.stdin){raw+=chunk;assert(Buffer.byteLength(raw)<=2*1024*1024);}console.log(JSON.stringify(await deliver(JSON.parse(raw))));}
  catch{console.log(JSON.stringify({state:'failed',detail:'invalid management request'}));process.exitCode=1;}
}
