// Runs as Claude's own SessionStart child; native inbox credentials never leave this process.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {messageRpc,childEnvironment} from './session-message-rpc.mjs';
function ownCredentials(env) {
  const socket=env.CLAUDE_CODE_MESSAGING_SOCKET,token=env.CLAUDE_CODE_MESSAGING_TOKEN;
  assert(typeof socket==='string'&&/^\\\\\.\\pipe\\[^\r\n\0]+$/.test(socket));
  assert(typeof token==='string'&&token.length>0&&token.length<=8192&&!/[\r\n\0]/.test(token));
  return {socket,token};
}
export async function sendInbox(text,env=process.env,connect=net.createConnection,timeoutMs=8000) {
  assert(typeof text==='string'&&Buffer.byteLength(text)>0&&Buffer.byteLength(text)<=256*1024);
  const {socket,token}=ownCredentials(env);
  return new Promise(resolve=>{
    let finished=false,written=false,total=0,pending='';
    const client=connect({path:socket});
    const finish=(state,detail)=>{if(finished)return;finished=true;clearTimeout(timer);client.destroy();resolve({state,detail});};
    const timer=setTimeout(()=>finish('unknown',written?'inbox-written-no-receipt':'inbox-response-unknown'),timeoutMs);
    client.once('connect',()=>{
      try {written=true;client.write(JSON.stringify({type:'auth',token})+'\n'+JSON.stringify({type:'user',message:{role:'user',content:text}})+'\n');}
      catch {finish('unknown','inbox-write-unknown');}
    });
    client.on('data',chunk=>{
      total+=chunk.length;if(total>16384)return finish('unknown','inbox-response-limit');pending+=chunk.toString('utf8');
      let at;while((at=pending.indexOf('\n'))>=0) {
        const line=pending.slice(0,at);pending=pending.slice(at+1);
        try {const r=JSON.parse(line);if(r?.refused===true||r?.status==='refused')finish('failed','inbox-refused');
          else if(r?.held===true||r?.status==='held')finish('unknown','inbox-held');}catch{}
      }
    });
    client.once('error',()=>finish(written?'unknown':'failed','inbox-connection-failed'));
    client.once('end',()=>finish('unknown','inbox-peer-end-no-message-receipt'));
    client.once('close',()=>finish('unknown','inbox-peer-close-no-message-receipt'));
  });
}
export async function runHook(m,input,env=process.env,dependencies={}) {
  assert(m.vendor==='claude'&&input.session_id===m.cli_session&&path.resolve(input.cwd)===path.resolve(m.cwd));
  assert(['SessionStart','SessionEnd'].includes(input.hook_event_name));
  const identity={instance:m.instance,owner:m.owner,task_id:m.task_id,vendor:'claude',cli_session:m.cli_session,token:env.AGENT_EVENT_TOKEN};
  if(input.hook_event_name==='SessionStart') {
    ownCredentials(env);
    if(input.model===undefined)assert(input.source==='resume'&&m.resume===true,'actual resume capability required');
    else assert(/^(?:claude-)?(opus|sonnet|haiku|fable)(?:-|$)/.exec(input.model||'')?.[1]===m.model,'actual hook model mismatch');
  }
  const make=()=>(dependencies.rpc||messageRpc)(childEnvironment(env));
  const retryMs=dependencies.retryMs??1000,giveUpMs=dependencies.giveUpMs??60000;
  let rpc=make(),failedAt=0,broken=false;
  // Transport failures only recreate the RPC connection; a message body is never resent.
  const request=async op=>{
    for(;;) {
      try {const r=await rpc.request(op);failedAt=0;broken=false;return r;}
      catch(error) {
        const now=Date.now();broken=true;if(!failedAt)failedAt=now;
        if(now-failedAt>=giveUpMs)throw error;
        try{rpc.close();}catch{}
        await new Promise(resolve=>setTimeout(resolve,retryMs));rpc=make();
      }
    }
  };
  let owns=false;const hook_id=randomUUID();
  try {
    if(input.hook_event_name==='SessionEnd') {await request({operation:'session-end',identity});return;}
    assert(['startup','resume'].includes(input.source));
    const ready=await request({operation:input.model===undefined?'bind-inbox':'ready',identity,hook_id,role:m.role,...(input.model!==undefined?{model:m.model}:{})});if(!ready?.ok)return;
    owns=true;
    const deadline=Date.now()+8*60*60*1000;
    while(Date.now()<deadline) {
      const next=await request({operation:'take',identity,hook_id});if(!next?.ok)break;
      if(next.message) {
        assert(next.message.operation==='message'&&next.message.cli_session===m.cli_session);
        let result;try{result=await(dependencies.send||sendInbox)(next.message.text,env);}catch{result={state:'failed',detail:'own-inbox-unavailable'};}
        const ack=await request({operation:'result',identity,hook_id,message_id:next.message.id,...result});
        if(!ack?.ok&&ack?.code!=='consumed_or_stale')break;
      } else await new Promise(resolve=>setTimeout(resolve,500));
    }
  } finally {
    // End is attempted once on any exit of the loop owner (not for compact/duplicate hooks); a connection that failed is replaced, errors are ignored.
    if(owns) try {
      if(broken){try{rpc.close();}catch{}rpc=make();}
      await rpc.request({operation:'end',identity,hook_id});
    } catch {}
    try{rpc.close();}catch{}
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));assert(m.kind==='ai-settings-message-launch');
    let raw='';for await(const c of process.stdin){raw+=c;assert(Buffer.byteLength(raw)<=65536);}
    await runHook(m,JSON.parse(raw));
  } catch {process.exitCode=1;} // No raw errors, credential, address or transcript output.
}
