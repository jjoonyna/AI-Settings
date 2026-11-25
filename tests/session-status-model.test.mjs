import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {attestStatusModel,formatStatus,usageSnapshot} from '../scripts/runtime/statusline.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('optional managed native statusline attests exact launch only; no credentials in RPC child/payload and display unchanged',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'status-model-')),dir=fs.mkdtempSync(path.join(root,'message-'));const file=path.join(dir,'launch.message.json');
 const m={kind:'ai-settings-message-launch',vendor:'claude',cli_session:id,owner:4,task_id:'task',instance:'i',role:'plan',model:'opus',cwd:process.cwd()};fs.writeFileSync(file,JSON.stringify(m));
 const env={AI_SETTINGS_CLAUDE_LAUNCH:file,AGENT_HUB_HOME:path.dirname(root),NVIM:'host',AGENT_EVENT_INSTANCE:'i',AGENT_SESSION_ID:'4',AGENT_TASK_ID:'task',AGENT_EVENT_TOKEN:'event',AGENT_SESSION_VENDOR:'claude',CLAUDE_CODE_MESSAGING_TOKEN:'CANARY',CLAUDE_CODE_MESSAGING_SOCKET:'CANARY',CLAUDE_CODE_SESSION_ID:id};
 // The fixed transport directory contract is required even for test fixtures.
 const hub=fs.mkdtempSync(path.join(os.tmpdir(),'status-hub-'));fs.mkdirSync(path.join(hub,'transports'));const owned=path.join(hub,'transports',path.basename(dir));fs.renameSync(dir,owned);env.AGENT_HUB_HOME=hub;env.AI_SETTINGS_CLAUDE_LAUNCH=path.join(owned,'launch.message.json');
 m.cwd=path.join(hub,'한글 작업');fs.mkdirSync(m.cwd);fs.writeFileSync(env.AI_SETTINGS_CLAUDE_LAUNCH,JSON.stringify(m));
 const data={session_id:id,cwd:m.cwd,model:{id:'claude-opus-4-7',display_name:'Opus'}};const before=formatStatus(data,usageSnapshot(data));let closed=0,calls=[];
 const rpc=child=>{assert(!Object.keys(child).some(k=>/^CLAUDE_CODE_(MESSAGING|SESSION)_/.test(k)));return {request:async r=>{calls.push(r);return {ok:true};},close(){closed++;}};};
 try{await attestStatusModel(data,env,rpc);assert.equal(calls.length,1);assert.equal(calls[0].operation,'model-attest');assert.equal(calls[0].model,'opus');assert(!JSON.stringify(calls).includes('CANARY'));assert.equal(closed,1);assert.equal(formatStatus(data,usageSnapshot(data)),before);
 for(const change of [{session_id:'bad'},{cwd:hub},{model:{} }])await attestStatusModel({...data,...change},env,rpc);assert.equal(calls.length,1);
 await attestStatusModel(data,{...env,CLAUDE_SESSION_ID:'wrong'},rpc);assert.equal(calls.length,1);
 const start=Date.now();await attestStatusModel(data,env,()=>({request:()=>new Promise(()=>{}),close(){closed++;}}));assert(Date.now()-start<600);assert.equal(closed,2);
 await attestStatusModel(data,{},()=>{throw Error('standalone must not RPC');});
 }finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(hub,{recursive:true,force:true});}
});
