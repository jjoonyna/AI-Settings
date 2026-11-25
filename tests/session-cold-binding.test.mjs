import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectCodex,codexRecipe} from '../scripts/runtime/session-codex.mjs';
import {prepare} from '../scripts/runtime/session-message-prepare.mjs';
import {tools} from '../scripts/runtime/session-tools.mjs';
const id='11111111-1111-4111-8111-111111111111';
function fixture({resume,name='작업 | persistence',nameFails=false,closeFails=false}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cold-binding-'));
  const o={role:'work',model:'gpt-6.1-sol',cwd:directory,executable:process.execPath,directory,runtime:path.resolve('scripts'),
    socket:path.join(directory,'ipc/c.sock'),instance:'cold-test',owner:4,task_id:'task',server:'synthetic-nvim',hub:path.join(directory,'hub'),name,resume};
  fs.writeFileSync(path.join(directory,'launch.message.json'),JSON.stringify(o));
  const recipe=codexRecipe(o,{NVIM:o.server,AGENT_HUB_HOME:o.hub,AGENT_EVENT_INSTANCE:o.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:o.task_id});
  const events=[];let persisted=!!resume,opens=0;
  const response=()=>({thread:{id},model:o.model,cwd:o.cwd,approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:{type:'workspaceWrite'}});
  const client=label=>({async close(){events.push(label+':close');return {exit:closeFails&&label==='bootstrap'?{pending:true}:{code:0,signal:null}};},async request(method,params){
    events.push(label+':'+method);
    if(method==='thread/start')return response();
    if(method==='thread/name/set') {assert.equal(label,'bootstrap');assert.deepEqual(params,{threadId:id,name});if(nameFails)throw Error('RAW_SECRET_NAME');persisted=true;return {};}
    if(method==='thread/resume'){assert(persisted,'cold empty thread has no persisted rollout');return response();}
    assert.equal(method,'mcpServerStatus/list','no queue/turn/body operation');
    return {data:[{name:'ai_settings_sessions',authStatus:'unsupported',runtimeStatus:'connected',serverInfo:{name:'ai-settings-sessions',version:'0.1.0'},serverCapabilities:{tools:{}},toolsError:null,
      resources:[],resourceTemplates:[],tools:Object.fromEntries(tools.map(t=>[t.name,t])),toolListMeta:{'ai-settings/session-bootstrap':{
        version:1,vendor:'codex',instance:o.instance,owner:o.owner,task_id:o.task_id,cli_session:id,runtime:o.runtime,server:o.server,hub:o.hub,endpoint:recipe.endpoint}}}],nextCursor:null};
  }});
  return {o,events,run:()=>inspectCodex(o,recipe,'--initialize',async()=>{opens++;assert(opens<=2,'no acquisition or mutation retry');return client(resume?'resume':opens===1?'bootstrap':'bound');}),clean:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
test('fresh thread persists its exact requested title before normal close and bound cold resume',async()=>{
  const f=fixture();try{const r=await f.run();assert.equal(r.code,0);assert.equal(r.result.initial_name,f.o.name);assert.equal(r.result.mcp_verified,true);
    assert.deepEqual(f.events,['bootstrap:thread/start','bootstrap:thread/name/set','bootstrap:close','bound:thread/resume','bound:mcpServerStatus/list','bound:close']);
  }finally{f.clean();}
});
test('native TUI keeps policy on the owned server and uses no unsupported remote overrides',()=>{
  const f=fixture();try {
    const recipe=codexRecipe(f.o,{NVIM:f.o.server,AGENT_HUB_HOME:f.o.hub,AGENT_EVENT_INSTANCE:f.o.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:f.o.task_id});
    const args=recipe.tuiArgs(id);assert(!args.includes('-c'));assert.equal(recipe.request.config.sandbox_mode,'workspace-write');
    assert.equal(recipe.request.config.approval_policy,'on-request');assert.equal(args[args.indexOf('--remote')+1],recipe.endpoint);
    assert.deepEqual(args.slice(-2),['resume',id]);assert(!JSON.stringify(args).includes('AGENT_EVENT_TOKEN'));
  }finally{f.clean();}
});
test('ambiguous name storage or bootstrap cleanup never resumes, publishes success or retries',async()=>{
  for(const options of [{nameFails:true},{closeFails:true}]){const f=fixture(options);try{const r=await f.run();assert.equal(r.code,1);assert.equal(r.result.mcp_verified,undefined);assert.equal(r.result.cmd,undefined);
    assert(!f.events.some(x=>x.includes('bound:')));assert.equal(f.events.filter(x=>x.includes('name/set')).length,1);assert.equal(f.events.filter(x=>x.includes(':close')).length,1);
    assert(!JSON.stringify(r).includes('RAW_SECRET'));
  }finally{f.clean();}}
});
test('resume preserves existing title; invalid new title is refused before thread mutation',async()=>{
  const f=fixture({resume:id});try{assert.equal((await f.run()).code,0);assert.deepEqual(f.events,['resume:thread/resume','resume:mcpServerStatus/list','resume:close']);}finally{f.clean();}
  for(const name of ['', 'bad\nname','a'.repeat(513)]){const f=fixture({name});try{assert.equal((await f.run()).code,1);assert.deepEqual(f.events,['bootstrap:close']);}finally{f.clean();}}
});
test('requested launcher title survives prepare into the internal Codex launch manifest',()=>{
  const f=fixture(),values={NVIM:f.o.server,AGENT_HUB_HOME:f.o.hub,AGENT_EVENT_INSTANCE:f.o.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:f.o.task_id};
  const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  try {
    Object.assign(process.env,values);const p=prepare({...f.o,vendor:'codex',cmd:['codex']},'codex-cli 0.172.0');
    assert.equal(JSON.parse(fs.readFileSync(p.manifest)).name,f.o.name);assert.equal(p.transport.ready,false);
    assert.equal(p.warning,undefined);
    const n=prepare({...f.o,vendor:'codex',cmd:['codex']},'codex-cli 0.173.0');assert.match(n.warning,/^Codex 0\.173\.0: 검증 버전 0\.172\.0보다 높습니다/);
    assert.throws(()=>prepare({...f.o,vendor:'codex',cmd:['codex']},'codex-cli 0.171.9'));
  }finally{for(const [k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;f.clean();}
});
test('linked Codex executable is pinned to its real binary in the launch manifest',()=>{
  const f=fixture(),values={NVIM:f.o.server,AGENT_HUB_HOME:f.o.hub,AGENT_EVENT_INSTANCE:f.o.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:f.o.task_id};
  const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  const real=path.join(f.o.directory,'release'),linked=path.join(f.o.directory,'bin');
  try {
    fs.mkdirSync(real);fs.copyFileSync(process.execPath,path.join(real,'codex.exe'));fs.symlinkSync(real,linked,'junction');
    Object.assign(process.env,values);const p=prepare({...f.o,vendor:'codex',executable:path.join(linked,'codex.exe'),cmd:['codex']},'codex-cli 0.172.0');
    const executable=JSON.parse(fs.readFileSync(p.manifest)).executable;
    assert.equal(executable,fs.realpathSync(path.join(real,'codex.exe')));assert.equal(fs.realpathSync(executable),executable);
  }finally{for(const [k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;f.clean();}
});
