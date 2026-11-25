import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {resolveClaudeCall} from '../scripts/runtime/session-model.mjs';
import {saveRole} from '../scripts/runtime/session-role.mjs';
const id='11111111-1111-4111-8111-111111111111';
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'claude-current-')),project=path.join(root,'projects','한글 테스트');fs.mkdirSync(project,{recursive:true});
 const env={CLAUDE_CONFIG_DIR:root,AI_SETTINGS_HOME:root,CLAUDE_SESSION_ID:id},file=path.join(project,id+'.jsonl');saveRole('claude',id,'plan',env);
 const record=(key,model='claude-opus-4-7',input={})=>({sessionId:id,type:'assistant',message:{model,content:[{type:'tool_use',id:key,name:'mcp__ai_settings_sessions__connection_status',input}]}});
 return {root,env,file,record,write:rows=>fs.writeFileSync(file,rows.map(x=>JSON.stringify(x)).join('\n')+'\n'),clean:()=>fs.rmSync(root,{recursive:true,force:true})};}
const meta={'claudecode/toolUseId':'current'};
test('current native toolUseId selects associated model/name/args in legitimate >616KB transcript; legacy is not substituted',()=>{
 const f=fixture();try{f.write([{sessionId:id,padding:'x'.repeat(620000)},f.record('old','claude-haiku-4-5'),f.record('current'),f.record('later','claude-sonnet-4-6')]);
 assert.equal(resolveClaudeCall(f.env,'connection_status',{},meta).model,'opus');
 for(const rows of [[f.record('current','claude-haiku-4-5')],[f.record('current'),f.record('current')],[{...f.record('current'),sessionId:'wrong'}],[f.record('current','claude-opus-4-7',{x:1})]]){
   f.write(rows);if(rows.length===1&&rows[0].message?.model==='claude-haiku-4-5')assert.equal(resolveClaudeCall(f.env,'connection_status',{},meta).model,'haiku');
   else assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));
 }
 f.write([f.record('current')]);for(const m of [undefined,{}, {'claudecode/toolUseId':''},{'claudecode/toolUseId':[]},{'claudecode/toolUseId':'bad\0'},{'claudecode/toolUseId':'x'.repeat(513)}])assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},m));
 const wrong=f.record('current');wrong.message.content[0].name='connection_status';f.write([wrong]);assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));
 f.write([{...f.record('current'),message:{model:'<synthetic>',content:f.record('current').message.content}}]);assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));
 }finally{f.clean();}
});
test('replacement/truncation and incomplete current-call records never become authority',async()=>{
 for(const mode of ['replace','truncate','partial']){
  const f=fixture();try{
   if(mode==='partial'){fs.writeFileSync(f.file,JSON.stringify(f.record('current')).slice(0,-2));assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));continue;}
   f.write([f.record('old')]);const script=mode==='replace'?"setTimeout(()=>{const f=require('fs');f.renameSync(process.argv[1],process.argv[1]+'.old');f.writeFileSync(process.argv[1],process.argv[2])},120)":"setTimeout(()=>require('fs').writeFileSync(process.argv[1],''),120)";
   const child=spawn(process.execPath,['-e',script,f.file,JSON.stringify(f.record('current'))+'\n'],{env:{},stdio:'ignore',windowsHide:true});const ended=new Promise(r=>child.once('exit',r));
   assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));assert.equal(await ended,0);
  }finally{f.clean();}
 }
});
test('own UUID reached only through a directory junction/symlink is refused',()=>{
 const f=fixture();try{f.write([f.record('current')]);const project=path.dirname(f.file),outside=path.join(f.root,'outside');fs.renameSync(project,outside);fs.symlinkSync(outside,project,'junction');
 assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));
 }finally{f.clean();}
});
test('only bounded readonly unflushed-ID observation waits; duplicate/mismatch/malformed/oversize never executes or falls back',async()=>{
 const f=fixture();let child;try{f.write([f.record('old')]);const append=JSON.stringify(f.record('current'))+'\n';
 child=spawn(process.execPath,['-e',"setTimeout(()=>require('fs').appendFileSync(process.argv[1],process.argv[2]),120)",f.file,append],{env:{},stdio:'ignore',windowsHide:true});
 const ended=new Promise(r=>child.once('exit',r));assert.equal(resolveClaudeCall(f.env,'connection_status',{},meta).model,'opus');assert.equal(await ended,0);
 f.write([f.record('old')]);const start=Date.now();assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));assert(Date.now()-start>=1900&&Date.now()-start<2600);
 for(const text of ['{broken}\n','x'.repeat(16*1024*1024+1)]){fs.writeFileSync(f.file,text);const before=Date.now();assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));assert(Date.now()-before<1000);}
 }finally{f.clean();}
});


test('valid 3MiB+ full history streams in bounded chunks and exact low current model never inherits old high model',()=>{
 const f=fixture(),read=fs.readSync,readFile=fs.readFileSync,open=fs.openSync;const descriptors=new Set();let largest=0;
 try{
  f.write([f.record('old','claude-opus-4-7'),...Array.from({length:64},()=>({sessionId:id,type:'context',padding:'한'.repeat(18000)})),f.record('current','claude-haiku-4-5')]);
  assert(fs.statSync(f.file).size>3*1024*1024);
  fs.openSync=(file,...args)=>{const fd=open(file,...args);if(file===f.file)descriptors.add(fd);return fd;};
  fs.readSync=(fd,buffer,offset,length,...args)=>{if(descriptors.has(fd)){largest=Math.max(largest,length);assert(length<=64*1024);}return read(fd,buffer,offset,length,...args);};
  fs.readFileSync=(file,...args)=>{assert.notEqual(file,f.file,'current reader must not buffer the transcript');return readFile(file,...args);};
  assert.equal(resolveClaudeCall(f.env,'connection_status',{},meta).model,'haiku');assert(largest>0);
 }finally{fs.readSync=read;fs.readFileSync=readFile;fs.openSync=open;f.clean();}
});
test('stream validates all history, including duplicate/wrong UUID after current and legitimate large image/context records',()=>{
 const f=fixture();try{
  const history={sessionId:id,type:'context',padding:'x'.repeat(3*1024*1024)};
  f.write([f.record('current'),history,f.record('current')]);assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));
  f.write([f.record('current'),history,{sessionId:'wrong',type:'context'}]);assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));
  f.write([{sessionId:id,type:'context',image:'x'.repeat(10*1024*1024)},f.record('current')]);assert.equal(resolveClaudeCall(f.env,'connection_status',{},meta).model,'opus');
  fs.appendFileSync(f.file,Buffer.from([0xff,0x0a]));assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));
 }finally{f.clean();}
});
test('digest rejects rewriting a previous prefix before appending otherwise valid current call',async()=>{
 const f=fixture();try{
  f.write([f.record('old')]);const script="setTimeout(()=>{const fs=require('fs');const p=process.argv[1];fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('old','bad')+process.argv[2])},150)";
  const child=spawn(process.execPath,['-e',script,f.file,JSON.stringify(f.record('current'))+'\n'],{env:{},stdio:'ignore',windowsHide:true});const ended=new Promise(r=>child.once('exit',r));
  assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));assert.equal(await ended,0);
 }finally{f.clean();}
});
test('partial current record can finish by append only, without reissuing the original call',async()=>{
 const f=fixture();try{
  const current=JSON.stringify(f.record('current'))+'\n',split=Math.floor(current.length/2);fs.writeFileSync(f.file,current.slice(0,split));
  const child=spawn(process.execPath,['-e',"setTimeout(()=>require('fs').appendFileSync(process.argv[1],process.argv[2]),120)",f.file,current.slice(split)],{env:{},stdio:'ignore',windowsHide:true});const ended=new Promise(r=>child.once('exit',r));
  assert.equal(resolveClaudeCall(f.env,'connection_status',{},meta).model,'opus');assert.equal(await ended,0);
 }finally{f.clean();}
});
test('append during a full scan is rescanned for duplicates; descriptor path replacement is refused',()=>{
 for(const mode of ['append','replace']){
  const f=fixture(),read=fs.readSync;let changed=false;try{
   f.write([f.record('current')]);
   fs.readSync=(...args)=>{const n=read(...args);if(!changed){changed=true;if(mode==='append')fs.appendFileSync(f.file,JSON.stringify(f.record('current'))+'\n');
     else{fs.renameSync(f.file,f.file+'.old');fs.writeFileSync(f.file,JSON.stringify(f.record('current'))+'\n');}}return n;};
   assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));assert(changed);
  }finally{fs.readSync=read;f.clean();}
 }
});
test('monotonic deadline is checked during sequential reads before a valid call can be authorized',()=>{
 const f=fixture(),read=fs.readSync,descriptor=Object.getOwnPropertyDescriptor(globalThis,'performance');let clock=0,reads=0;
 try{f.write([{sessionId:id,padding:'x'.repeat(3*1024*1024)},f.record('current')]);
  Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock}});
  fs.readSync=(...args)=>{reads++;const n=read(...args);clock=2001;return n;};
  assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));assert.equal(reads,1);
 }finally{Object.defineProperty(globalThis,'performance',descriptor);fs.readSync=read;f.clean();}
});
test('transcript lookup checks only projects/<project>/<id>.jsonl, regardless of nested session folders',()=>{
 const f=fixture();try{
  f.write([f.record('current')]);
  for(let i=0;i<300;i++)fs.mkdirSync(path.join(f.root,'projects','p'+i,'s'+i,'subagents'),{recursive:true});
  fs.writeFileSync(path.join(f.root,'projects','p0','s0','subagents',id+'.jsonl'),JSON.stringify(f.record('current','claude-haiku-4-5'))+'\n');
  assert.equal(resolveClaudeCall(f.env,'connection_status',{},meta).model,'opus');
  fs.mkdirSync(path.join(f.root,'projects','p1',id+'.jsonl'));
  assert.throws(()=>resolveClaudeCall(f.env,'connection_status',{},meta));
 }finally{f.clean();}
});
