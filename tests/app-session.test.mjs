import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Frames, frame, executable } from '../scripts/runtime/app-proxy.mjs';
import { validate, handoff, readThread } from '../scripts/runtime/app-session.mjs';
import { install } from '../scripts/install-runtime.mjs';
const id = '12345678-1234-1234-1234-123456789abc';
const turnId = '12345678-1234-1234-1234-123456789abd';
const otherTurnId = '12345678-1234-1234-1234-123456789abe';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-'));
  fs.mkdirSync(path.join(root, 'sessions')); fs.copyFileSync('runtime/models.json', path.join(root, 'models.json'));
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ id, thread_name: '계획 | test' }));
  fs.writeFileSync(path.join(root, 'sessions', `rollout-${id}.jsonl`), [{type:'session_meta',payload:{id}}, {type:'turn_context',payload:{model:'gpt-6.1-sol'}}].map(JSON.stringify).join('\n'));
  const doc = path.join(root, 'doc'); fs.writeFileSync(doc, 'test');
  return { root, env: { CODEX_HOME: root, AI_SETTINGS_HOME: root, CODEX_THREAD_ID: id }, o: { agent:'codex', session:'review', model:'gpt-6-luna', name:'test', goal:'goal', scope:'scope', validation:'test', prompt:'prompt', spec_doc:doc, plan_doc:doc, cwd:root } };
}
test('parent identity, role, vendor, model ceiling and fields fail closed', () => {
  const {root, env, o} = fixture(); try {
    assert.equal(validate(o, env).id, id);
    for (const bad of [{...o,model:'gpt-6-astra',user_override:true},{...o,agent:'claude'}, {...o,session:'plan'}, {...o,parent_model:'gpt-6-luna'}, {...o,goal:''}, {...o,spec_doc:path.join(root,'missing')}]) assert.throws(() => validate(bad, env));
    assert.throws(() => validate(o, {...env,CODEX_SESSION_ID:'wrong'}));
    fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({id,thread_name:'작업 | test'}));
    assert.throws(() => validate({...o,user_override:true}, env));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('server permissions verified before turn; errors retain created ID', async () => {
  const {root,env,o} = fixture(), calls=[]; let bad = true;
  const open = async () => ({ userAgent:'codex-tui/0.154.0', close(){}, async request(method, params) { calls.push(method); if(method === 'thread/start') { assert.equal(params.sandbox,'read-only'); assert.equal(params.config,undefined); return {thread:{id},model:o.model,cwd:root,sandbox:{type:bad?'workspaceWrite':'readOnly'},approvalPolicy:'on-request',approvalsReviewer:'auto_review'}; } if(method === 'turn/start') { const prompt=params.input[0].text; assert.ok(prompt.includes('읽기 전용 리뷰다. 코드, 문서 또는 파일을 수정·생성·삭제하지 않는다. 실제 변경 원문과 요구사항·검증 근거를 확인한다.')); return {turn:{id:turnId,status:'inProgress'}}; } return {}; } });
  try { await assert.rejects(handoff(o,env,open), /created thread.*mismatch/); assert.deepEqual(calls,['thread/start']); bad=false; calls.length=0; assert.equal((await handoff(o,env,open)).turnId,turnId); assert.deepEqual(calls,['thread/start','thread/name/set','turn/start']); } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('Windows app cores choose the latest valid version and fall back to PATH', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-core-'));
  try {
    const bin=path.join(root,'OpenAI','Codex','bin'), fallback=path.join(root,'fallback'); fs.mkdirSync(fallback);
    fs.writeFileSync(path.join(fallback,'codex.exe'),'');
    for(const name of ['old','alpha','stable','bad']) { fs.mkdirSync(path.join(bin,name),{recursive:true}); fs.writeFileSync(path.join(bin,name,'codex.exe'),''); }
    const versions={old:'codex-cli 0.154.0',alpha:'codex-cli 0.166.0-alpha.5.1',stable:'codex-cli 0.166.0',bad:'invalid'};
    const run=(file,args,options)=>{ assert.deepEqual(args,['--version']); assert.equal(options.timeout,5000); return versions[path.basename(path.dirname(file))]; };
    const env={LOCALAPPDATA:root,PATH:fallback};
    assert.equal(executable(env,'win32',run),path.join(bin,'stable','codex.exe'));
    delete versions.stable; assert.equal(executable(env,'win32',run),path.join(bin,'alpha','codex.exe'));
    assert.equal(executable(env,'win32',()=>{throw new Error('failed');}),path.join(fallback,'codex.exe'));
    assert.throws(()=>executable({LOCALAPPDATA:root,PATH:''},'win32',()=>{throw new Error('failed');}),/not found/);
    fs.writeFileSync(path.join(fallback,'codex'),''); assert.equal(executable(env,'linux',()=>{throw new Error('must not run');}),path.join(fallback,'codex'));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('review keeps read-only request and explicit no-edit instruction without requiring MXC', async () => {
  const {root,env,o}=fixture(), calls=[];
  try {
    const legacy=async()=>({userAgent:'codex-tui/0.154.0',close(){},async request(method,p){calls.push(method); if(method==='thread/start'){assert.equal(p.sandbox,'read-only'); assert.equal(p.config,undefined); return {thread:{id},model:o.model,cwd:root,sandbox:{type:'readOnly'},approvalPolicy:'on-request',approvalsReviewer:'auto_review'};} if(method==='turn/start')return {turn:{id:turnId,status:'inProgress'}}; return {};}});
    await handoff(o,env,legacy); assert.deepEqual(calls,['thread/start','thread/name/set','turn/start']);
    calls.length=0; const work=async()=>({userAgent:'codex-tui/0.154.0',close(){},async request(method,p){calls.push(method); if(method==='thread/start'){assert.equal(p.config,undefined); return {thread:{id},model:o.model,cwd:root,sandbox:{type:'workspaceWrite'},approvalPolicy:'on-request',approvalsReviewer:'auto_review'};} if(method==='turn/start')return {turn:{id:turnId,status:'inProgress'}}; return {};}});
    await handoff({...o,session:'work'},env,work); assert.deepEqual(calls,['thread/start','thread/name/set','turn/start']);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('metadata-only read and paged latest result work with a long history', async () => {
  const history = 'x'.repeat(17 * 1024 * 1024); let pages = 0;
  const open=async()=>({close(){},async request(method,p){
    if(method==='thread/read') { assert.equal(p.includeTurns,false); if(p.includeTurns) return {history}; return {thread:{status:{type:'notLoaded'}}}; }
    if(method==='thread/turns/list') { assert.equal(p.limit,1); assert.equal(p.sortDirection,'desc'); assert.equal(p.itemsView,'notLoaded'); return {data:[{id:turnId,status:'completed'}]}; }
    assert.equal(p.turnId,turnId); pages++; return p.cursor ? {data:[{item:{type:'agentMessage',phase:'final_answer',text:'done'}}],nextCursor:null} : {data:[],nextCursor:'next'};
  }});
  const result=await readThread(id,turnId,open); assert.equal(pages,2); assert.equal(result.status,'completed'); assert.equal(result.final,'done');
});
test('completion requires the expected latest turn', async () => {
  let live='notLoaded', state='completed'; const open=async()=>({close(){},async request(method){
    if(method==='thread/read') return {thread:{status:{type:live}}};
    if(method==='thread/turns/list') return {data:[{id:turnId,status:state}]};
    return {data:[{item:{type:'agentMessage',phase:'final_answer',text:'old report'}}]};
  }});
  let r=await readThread(id,undefined,open); assert.equal(r.status,'unknown'); assert.equal(r.final,'old report');
  r=await readThread(id,otherTurnId,open); assert.equal(r.status,'unknown'); assert.equal(r.expectedTurnMatches,false);
  r=await readThread(id,turnId,open); assert.equal(r.status,'completed'); assert.equal(r.expectedTurnMatches,true);
  live='active'; assert.equal((await readThread(id,turnId,open)).status,'active'); assert.equal((await readThread(id,undefined,open)).status,'active');
  live='idle'; r=await readThread(id,undefined,open); assert.equal(r.status,'unknown'); assert.equal(r.final,'old report');
  live='notLoaded'; state='interrupted'; assert.equal((await readThread(id,turnId,open)).status,'interrupted');
  state='failed'; assert.equal((await readThread(id,turnId,open)).status,'failed');
  await assert.rejects(readThread(id,'bad',open), /expected turn ID/);
});
test('websocket frame fragmentation, control and limits', () => {
  let messages=[], controls=[]; const p=new Frames(b=>messages.push(b.toString()),(op)=>controls.push(op));
  p.push(Buffer.from([1,2,104,105,0x89,0,0x80,1,33])); assert.deepEqual(messages,['hi!']); assert.deepEqual(controls,[9]);
  assert.throws(()=>new Frames(()=>{},()=>{}).push(Buffer.from([0x81,0x80,0,0,0,0])));
  assert.throws(()=>new Frames(()=>{},()=>{}).push(Buffer.from([0x80,0])));
  assert.equal(frame('x')[1]&128,128);
});
test('installation copies app runtime and policy', () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'remote-install-')); try { const home=path.join(temp,'home'); const r=install({home,nvim:path.join(temp,'nvim'),mode:'codex',skipTools:true}); for(const f of ['app-proxy.mjs','app-session.mjs','session.mjs']) assert.deepEqual(fs.readFileSync(path.join(r.root,'bin',f)),fs.readFileSync(path.join('scripts/runtime',f))); assert.deepEqual(fs.readFileSync(path.join(r.root,'POLICY.md')),fs.readFileSync('runtime/POLICY.md')); } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
