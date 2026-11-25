import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {sendInbox,runHook} from '../scripts/runtime/session-inbox.mjs';
import {prepare} from '../scripts/runtime/session-message-prepare.mjs';
const env={AGENT_EVENT_TOKEN:'synthetic-event',CLAUDE_CODE_MESSAGING_TOKEN:'synthetic-inbox-secret',CLAUDE_CODE_MESSAGING_SOCKET:'\\\\.\\pipe\\synthetic-own'};
test('own pipe sends once; a write/auth reply cannot claim message execution or delivery',async()=>{
  let writes=[];const socket=new EventEmitter();socket.destroy=()=>{};
  socket.write=value=>{writes.push(value);queueMicrotask(()=>socket.emit('data',Buffer.from('{"type":"auth","ok":true}\n')));};
  const r=await sendInbox('synthetic body',env,()=>{queueMicrotask(()=>socket.emit('connect'));return socket;},5);
  assert.equal(writes.length,1);assert(writes[0].includes('synthetic-inbox-secret'));assert.equal(r.state,'unknown');assert(!JSON.stringify(r).includes('secret'));
});
test('exact hook UUID/model/cwd; RPC child receives no inbox auth; one claimed body is not retried',async()=>{
  const id='11111111-1111-4111-8111-111111111111',m={vendor:'claude',cli_session:id,cwd:process.cwd(),owner:1,instance:'i',task_id:'t',model:'sonnet',role:'work'};
  const input={hook_event_name:'SessionStart',session_id:id,cwd:m.cwd,source:'startup',model:'claude-sonnet-4-6'};
  let count=0,sends=0;const packets=[];
  const dependencies={rpc:child=>{assert.equal(child.CLAUDE_CODE_MESSAGING_TOKEN,undefined);assert.equal(child.CLAUDE_CODE_MESSAGING_SOCKET,undefined);return {request:async r=>{packets.push(r);if(r.operation==='take')return ++count===1?{ok:true,message:{id:'m',text:'body',operation:'message',cli_session:id}}:{ok:false};return {ok:true};},close(){}};},send:async()=>{sends++;return {state:'unknown',detail:'no receipt'};}};
  await runHook(m,input,env,dependencies);assert.equal(sends,1);assert(!JSON.stringify(packets).includes('synthetic-inbox-secret'));
  assert(packets.some(p=>p.operation==='result'&&p.state==='unknown'));
  await assert.rejects(runHook(m,{...input,session_id:'wrong'},env,dependencies));
  await assert.rejects(runHook(m,{...input,model:'opus'},env,dependencies));
});
test('managed prepare merges only CLI hook settings; no prompt, Channels, permission override, or auth persisted',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'message-prepare-'));
  const o={vendor:'claude',role:'review',model:'sonnet',owner:1,instance:'i',task_id:'t',executable:process.execPath,cwd:process.cwd(),directory:dir,
    cmd:[process.execPath,'--model','sonnet','--permission-mode','bypassPermissions']};
  const r=prepare(o,'2.1.331 (Claude Code)');assert(r.cmd.includes('--session-id'));assert(!r.cmd.includes('--channels'));assert(!r.cmd.includes('body'));
  const manifest=fs.readFileSync(r.manifest,'utf8'),settings=fs.readFileSync(path.join(path.dirname(r.manifest),'settings.json'),'utf8');
  assert(!manifest.includes('token')&&!settings.includes('synthetic-inbox-secret'));assert.equal(JSON.parse(settings).hooks.SessionStart[0].hooks[0].async,true);
  assert.throws(()=>prepare({...o,vendor:'codex'},'codex-cli 0.172.0'));
  assert.throws(()=>prepare(o,'2.1.185'));
  assert.equal(prepare(o,'2.1.331 (Claude Code)').warning,undefined);
  assert.match(prepare(o,'2.1.332 (Claude Code)').warning,/^Claude 2\.1\.332: 검증 버전 2\.1\.331보다 높습니다/);
  assert.throws(()=>prepare({...o,vendor:'codex'},'codex-cli 0.171.9'));
  assert.throws(()=>prepare(o,'RAW_SECRET_VERSION'),e=>!String(e.message).includes('RAW_SECRET'));
  const id='11111111-1111-4111-8111-111111111111';
  const resumed=prepare({...o,resume:id,cmd:[process.execPath,'--continue']},'2.1.331');
  assert.deepEqual(resumed.cmd.slice(0,3),[process.execPath,'--resume',id]);assert(!resumed.cmd.includes('--session-id'));
  assert(resumed.cmd.includes('--model')&&resumed.cmd.includes('sonnet')&&resumed.cmd.includes('bypassPermissions'));
  const custom=prepare({...o,resume:id,cmd:[process.execPath,'--resume',id,'--mcp-config','personal-mcp.json','--add-dir',dir]},'2.1.331');
  assert(custom.cmd.includes('personal-mcp.json')&&custom.cmd.includes('--add-dir'),'resume preserves supplied CLI options');
  assert(custom.cmd.some(s=>s.endsWith('/claude-mcp.json')||s.endsWith('\\claude-mcp.json')),'managed MCP config required on resume');
});
test('actual resume missing optional model registers capability only; present wrong/startup missing still fail before RPC',async()=>{
 const id='11111111-1111-4111-8111-111111111111',m={vendor:'claude',cli_session:id,cwd:process.cwd(),owner:1,instance:'i',task_id:'t',model:'opus',role:'plan',resume:true};
 const input={hook_event_name:'SessionStart',session_id:id,cwd:m.cwd,source:'resume'};const packets=[];let closes=0;
 const deps={rpc:child=>{assert(!Object.keys(child).some(k=>/^CLAUDE_CODE_(SESSION|MESSAGING)_/.test(k)));return {request:async q=>{packets.push(q);return q.operation==='take'?{ok:false}:{ok:true};},close(){closes++;}};},send:()=>{throw Error('no body');}};
 await runHook(m,input,env,deps);assert.equal(packets[0].operation,'bind-inbox');assert.equal(packets[0].model,undefined);assert.equal(closes,1);
 for(const change of [{source:'startup'},{model:'haiku'},{model:''},{model:null}])await assert.rejects(runHook(m,{...input,...change},env,deps));
});
test('Codex prepare owns an explicit new endpoint without starting a process or persisting event credentials',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-prepare-'));
  const keys=['NVIM','AGENT_HUB_HOME','AGENT_EVENT_INSTANCE','AGENT_SESSION_ID','AGENT_TASK_ID','AGENT_EVENT_TOKEN'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    Object.assign(process.env,{NVIM:'synthetic',AGENT_HUB_HOME:dir,AGENT_EVENT_INSTANCE:'i',AGENT_SESSION_ID:'1',AGENT_TASK_ID:'t',AGENT_EVENT_TOKEN:'DO_NOT_PERSIST'});
    const r=prepare({vendor:'codex',role:'plan',model:'gpt-6.1-sol',owner:1,instance:'i',task_id:'t',executable:process.execPath,cwd:process.cwd(),directory:dir,cmd:[process.execPath]},'codex-cli 0.172.0');
    assert(r.server_cmd.includes('--serve'));assert.equal(r.transport.ready,false);assert(r.transport.endpoint.startsWith('unix://'));
    assert(!fs.existsSync(path.dirname(r.transport.endpoint.slice(7))),'native CLI must create its own private socket directory');
    assert(!JSON.stringify(r).includes('DO_NOT_PERSIST'));assert(!fs.readFileSync(r.manifest,'utf8').includes('DO_NOT_PERSIST'));
    assert.equal(r.cmd,undefined,'TUI command waits for verified server UUID');
  } finally {for(const k of keys)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];fs.rmSync(dir,{recursive:true,force:true});}
});
