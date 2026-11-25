import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {codexRecipe,inspectCodex} from '../scripts/runtime/session-codex.mjs';
import {tools} from '../scripts/runtime/session-tools.mjs';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function fixture() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'launch-claim-'));
  const o={kind:'ai-settings-codex-launch',role:'work',model:'gpt-6.1-sol',cwd:directory,executable:process.execPath,directory,runtime:fs.realpathSync('scripts'),
    socket:path.join(directory,'private/c.sock'),instance:'claim-test',owner:4,task_id:'task',server:'synthetic',hub:directory,name:'work | claim'};
  const file=path.join(directory,'launch.message.json'),bound=path.join(directory,'launch.bound.message.json');fs.writeFileSync(file,JSON.stringify(o));
  const recipe=codexRecipe(o,{NVIM:o.server,AGENT_HUB_HOME:o.hub,AGENT_EVENT_INSTANCE:o.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:o.task_id});
  const calls=[];let closes=0;
  const open=async()=>({close:async()=>{closes++;return {exit:{code:0}};},request:async(method)=>{
    calls.push(method);if(method==='thread/start'&&f.start)await f.start();
    if(method!=='mcpServerStatus/list')return {thread:{id},model:o.model,cwd:o.cwd,approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:{type:'dangerFullAccess'}};
    return {data:[{name:'ai_settings_sessions',runtimeStatus:'connected',authStatus:'unsupported',toolsError:null,serverInfo:{name:'ai-settings-sessions',version:'0.1.0'},serverCapabilities:{tools:{}},resources:[],resourceTemplates:[],
      tools:Object.fromEntries(tools.map(t=>[t.name,t])),toolListMeta:{'ai-settings/session-bootstrap':{version:1,vendor:'codex',instance:o.instance,owner:o.owner,task_id:o.task_id,cli_session:id,runtime:o.runtime,server:o.server,hub:o.hub,endpoint:recipe.endpoint}}}],nextCursor:null};
  }});
  const f={o,file,bound,calls,closeCount:()=>closes,run:()=>inspectCodex(o,recipe,'--initialize',open),clean:()=>fs.rmSync(directory,{recursive:true,force:true})};return f;
}
test('changed launch is refused before the first native mutation',async()=>{
  const f=fixture();try{fs.writeFileSync(f.file,JSON.stringify({...f.o,task_id:'changed'}));assert.equal((await f.run()).code,1);assert.deepEqual(f.calls,[]);assert.equal(f.closeCount(),1);}finally{f.clean();}
});
test('concurrent initialization claims one launch once and publishes exactly one immutable UUID',async()=>{
  const f=fixture();let release,entered,starts=0;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);f.start=async()=>{if(++starts===1){entered();await gate;}};
  try {
    const first=f.run();await started;const second=await f.run();release();const success=await first;
    assert.equal(second.code,1);assert.equal(success.code,0);assert.equal(f.calls.filter(x=>x==='thread/start').length,1);
    assert.equal(JSON.parse(fs.readFileSync(f.bound)).cli_session,id);assert.equal(JSON.parse(fs.readFileSync(f.file)).cli_session,undefined);
    assert.equal((await f.run()).code,1);assert.equal(f.calls.filter(x=>x==='thread/start').length,1);
  }finally{release();f.clean();}
});
test('publication never overwrites a competing UUID and unknown start outcomes never replay',async()=>{
  for(const competing of [true,false]){const f=fixture();try {
    f.start=async()=>{if(competing)fs.writeFileSync(f.bound,JSON.stringify({...f.o,cli_session:other}),{flag:'wx'});else throw Error('synthetic unknown start outcome');};
    assert.equal((await f.run()).code,1);assert.equal((await f.run()).code,1);assert.equal(f.calls.filter(x=>x==='thread/start').length,1);
    if(competing)assert.equal(JSON.parse(fs.readFileSync(f.bound)).cli_session,other);else assert(!fs.existsSync(f.bound));
    assert.equal(f.closeCount(),2);
  }finally{f.clean();}}
});
