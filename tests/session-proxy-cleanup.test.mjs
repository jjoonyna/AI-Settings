import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectCodex,codexRecipe} from '../scripts/runtime/session-codex.mjs';
import {tools} from '../scripts/runtime/session-tools.mjs';
const id='11111111-1111-4111-8111-111111111111',normal={exit:{code:0,signal:null}};
function scenario(stage,cleanup=normal,verificationError) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'proxy-cleanup-'));
  const o={role:'work',model:'gpt-6.1-sol',cwd:process.cwd(),executable:process.execPath,directory,runtime:path.resolve('scripts'),
    socket:path.join(directory,'ipc/c.sock'),instance:'proxy-test',owner:4,task_id:'task',server:'synthetic-nvim',hub:path.join(directory,'hub')};
  if(stage==='resume')o.resume=id;if(stage==='post')o.cli_session=id;
  fs.writeFileSync(path.join(directory,'launch.message.json'),JSON.stringify(o));
  const recipe=codexRecipe(o,{NVIM:o.server,AGENT_HUB_HOME:o.hub,AGENT_EVENT_INSTANCE:o.instance,AGENT_SESSION_ID:'4',AGENT_TASK_ID:o.task_id});
  const events=[];let opened=0;
  const make=label=>({closed:0,async close(){this.closed++;events.push(label+':close');
    const selected=(stage==='bound'?label==='bound':label==='outer')?cleanup:normal;
    if(typeof selected==='function')return selected();return selected;},
    async request(method){events.push(label+':'+method);
      assert(['thread/start','thread/name/set','thread/resume','mcpServerStatus/list'].includes(method),'body/turn/retry forbidden');
      if(verificationError&&method==='mcpServerStatus/list')throw verificationError;
      if(method!=='mcpServerStatus/list')return {thread:{id},model:o.model,cwd:o.cwd,approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:{type:'workspaceWrite'}};
      return {data:[{name:'ai_settings_sessions',authStatus:'unsupported',runtimeStatus:'connected',serverInfo:{name:'ai-settings-sessions',version:'0.1.0'},serverCapabilities:{tools:{}},toolsError:null,
        resources:[],resourceTemplates:[],tools:Object.fromEntries(tools.map(t=>[t.name,t])),toolListMeta:{'ai-settings/session-bootstrap':{version:1,vendor:'codex',instance:o.instance,owner:o.owner,task_id:o.task_id,
          cli_session:id,runtime:o.runtime,server:o.server,hub:o.hub,endpoint:recipe.endpoint}}}],nextCursor:null};
    }});
  const outer=make('outer'),bound=make('bound');
  return {o,events,outer,bound,directory,run:()=>inspectCodex(o,recipe,stage==='post'?'--check':'--initialize',async()=>{
    assert(opened<2,'no automatic retry');events.push('open:'+opened);return opened++===0?outer:bound;})};
}
test('RED: resume and post cannot publish MCP success when outer proxy cleanup is pending',async()=>{
  for(const stage of ['resume','post']) {
    const s=scenario(stage,{exit:{pending:true}});
    try {const output=await s.run();assert.equal(output.code,1,stage+' pending cleanup must fail');assert.equal(output.result.mcp_verified,undefined);}
    finally {fs.rmSync(s.directory,{recursive:true,force:true});}
  }
});
test('inspection rejects pending/unknown/nonzero/thrown cleanup across bootstrap, bound, resume and post',async()=>{
  const bad=[{exit:{pending:true}},{},{exit:{code:9}},{exit:{code:0,signal:'SIGINT'}},()=>{throw new Error('RAW_SECRET_CLEANUP');}];
  for(const stage of ['bootstrap','bound','resume','post'])for(const cleanup of bad) {
    const s=scenario(stage,cleanup);
    try {
      const output=await s.run();assert.equal(output.code,1,stage+' must refuse ambiguous/abnormal cleanup');
      assert.equal(output.result.mcp_verified,undefined);assert.equal(output.result.cmd,undefined);
      assert(!JSON.stringify(output).includes('RAW_SECRET'));
      assert.equal(s.outer.closed,1,'outer must be closed exactly once');
      assert.equal(s.bound.closed,stage==='bound'?1:0,'failed bootstrap must not open bound proxy');
      const files=fs.readdirSync(s.directory).filter(n=>n.startsWith('inspection-failure'));
      assert.equal(files.length,1,'cleanup failure must leave sanitized evidence');
      const saved=fs.readFileSync(path.join(s.directory,files[0]),'utf8');assert(!saved.includes('RAW_SECRET'));
    } finally {fs.rmSync(s.directory,{recursive:true,force:true});}
  }
});
test('success is published only after every required normal close and without a duplicate outer close',async()=>{
  for(const stage of ['bootstrap','bound','resume','post']) {
    let release;const gate=new Promise(resolve=>{release=resolve;});
    const s=scenario(stage,()=>gate);let published=false;
    try {
      const result=s.run().then(value=>{published=true;s.events.push('published');return value;});
      for(let i=0;i<20&&!s.events.includes((stage==='bound'?'bound':'outer')+':close');i++)await new Promise(r=>setTimeout(r,1));
      assert.equal(published,false,'must await cleanup before publication');release(normal);
      const output=await result;assert.equal(output.code,0);assert.equal(output.result.mcp_verified,true);assert(output.result.cmd);
      assert.equal(s.outer.closed,1);assert.equal(s.bound.closed,['bootstrap','bound'].includes(stage)?1:0);
      assert.equal(s.events.at(-1),'published');
    } finally {release(normal);fs.rmSync(s.directory,{recursive:true,force:true});}
  }
});
test('verification and cleanup failure are both preserved while publication stays failure-only',async()=>{
  for(const stage of ['bound','resume','post'])for(const closeFails of [false,true]) {
    const s=scenario(stage,closeFails?()=>{throw new Error('RAW_SECRET_CLOSE');}:normal,new Error('RAW_SECRET_VERIFY'));
    try {
      const output=await s.run();assert.equal(output.code,1);assert.equal(output.result.mcp_verified,undefined);
      const file=fs.readdirSync(s.directory).find(n=>n.startsWith('inspection-failure'));
      assert(file,'both failures must leave sanitized diagnostic evidence');
      const raw=fs.readFileSync(path.join(s.directory,file),'utf8'),record=JSON.parse(raw);
      assert.equal(record.verification_failed,true);assert.equal(record.cleanup_failures.length,closeFails?1:0);assert(!raw.includes('RAW_SECRET'));
      assert.equal(s.outer.closed,1);assert.equal(s.bound.closed,stage==='bound'?1:0);
    } finally {fs.rmSync(s.directory,{recursive:true,force:true});}
  }
});
