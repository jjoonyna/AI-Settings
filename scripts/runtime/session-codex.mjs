// One owned native server per managed terminal; never connects the default daemon.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {connectNative,ProxyCleanupError,NativeConnectError,verifyProxyCleanup,waitNativeReady} from './session-native.mjs';
import {childEnvironment} from './session-message-rpc.mjs';
import {tools} from './session-tools.mjs';
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const proxyCleanups=new WeakMap();
function closeInspectionProxy(client,label) {
  if(!proxyCleanups.has(client))proxyCleanups.set(client,(async()=>{
    let cleanup;
    try {cleanup=await client.close();}catch(error){throw error instanceof ProxyCleanupError?error:new ProxyCleanupError(label,'thrown');}
    return verifyProxyCleanup(cleanup,label);
  })());
  return proxyCleanups.get(client);
}
async function withClosedProxy(client,label,operation) {
  let result,error,failed=false;
  try {result=await operation();}catch(value){error=value;failed=true;}
  try {await closeInspectionProxy(client,label);}catch(cleanupError){
    if(failed&&error!==cleanupError)throw new AggregateError([error,cleanupError],'MCP verification and proxy cleanup failed');
    throw cleanupError;
  }
  if(failed)throw error;
  return result;
}
export function codexRecipe(o,env) {
  assert(['plan','work','review'].includes(o.role)&&typeof o.model==='string'&&o.model.length>0);
  assert(path.isAbsolute(o.cwd)&&path.isAbsolute(o.directory)&&path.isAbsolute(o.runtime)&&path.isAbsolute(o.executable));
  assert(path.isAbsolute(o.socket));
  const endpoint='unix://'+o.socket.replaceAll('\\','/');
  const identity={};
  for(const key of ['NVIM','AI_SETTINGS_HOME','AGENT_HUB_HOME','AGENT_EVENT_INSTANCE','AGENT_SESSION_ID','AGENT_TASK_ID','AGENT_SESSION_VENDOR'])if(env[key])identity[key]=env[key];
  assert(identity.NVIM&&identity.AGENT_EVENT_INSTANCE===o.instance&&identity.AGENT_SESSION_ID===String(o.owner)&&identity.AGENT_TASK_ID===o.task_id);
  assert(identity.NVIM===o.server&&path.resolve(identity.AGENT_HUB_HOME||'')===o.hub,'MCP launch identity mismatch');
  identity.AI_SETTINGS_HOME=o.runtime;
  identity.AI_SETTINGS_MCP_ENDPOINT=endpoint;
  identity.AI_SETTINGS_MCP_CONTEXT=path.join(o.directory,'launch.bound.message.json');
  identity.AI_SETTINGS_MCP_ROLE=o.role;identity.AI_SETTINGS_MCP_MODEL=o.model;
  const config={model:o.model,approval_policy:o.role==='review'?'never':'on-request',approvals_reviewer:'auto_review',
    sandbox_mode:'danger-full-access',
    'mcp_servers.ai_settings_sessions':{enabled:true,command:process.execPath,args:[path.join(o.runtime,'bin/session-tools.mjs')],env:{...identity,AGENT_SESSION_VENDOR:'codex'},env_vars:['CODEX_HOME']}};
  const toml=value=>typeof value==='object'&&!Array.isArray(value)?'{'+Object.entries(value).map(([k,v])=>JSON.stringify(k)+'='+toml(v)).join(',')+'}':JSON.stringify(value);
  const overrides=value=>Object.entries(value).flatMap(([k,v])=>['-c',k+'='+toml(v)]);
  const request={cwd:o.cwd,model:o.model,approvalPolicy:config.approval_policy,approvalsReviewer:'auto_review',config,
    sandbox:config.sandbox_mode};
  return {endpoint,serverArgs:[...overrides(config),'app-server','--listen',endpoint],request,
    tuiArgs(id){assert(uuid.test(id));return [o.executable,'--profile',o.role,'--model',o.model,'--remote',endpoint,'-C',o.cwd,'resume',id];}};
}
export function verifyCodex(r,o) {
  assert(uuid.test(r?.thread?.id||''));if(o.resume)assert.equal(r.thread.id,o.resume);
  assert.equal(r.model,o.model);assert.equal(path.resolve(r.cwd),path.resolve(o.cwd));
  assert.equal(r.approvalPolicy,o.role==='review'?'never':'on-request');assert.equal(r.approvalsReviewer,'auto_review');
  assert.equal(r.sandbox?.type,'dangerFullAccess');
  return r.thread.id;
}
function launchFile(o,name='launch.message.json') {
  const file=path.join(o.directory,name);
  assert.equal(fs.realpathSync(file),path.resolve(file));const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16384);
  const fd=fs.openSync(file,'r'),bytes=Buffer.alloc(16385);let length;
  try {const opened=fs.fstatSync(fd);assert(opened.isFile()&&opened.dev===stat.dev&&opened.ino===stat.ino);
    length=fs.readSync(fd,bytes,0,bytes.length,0);}finally{fs.closeSync(fd);}
  assert(length<=16384);const raw=bytes.subarray(0,length);return {raw,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
}
function claimLaunch(o) {
  const original=launchFile(o);assert.deepEqual(original.value,JSON.parse(JSON.stringify(o)),'launch context changed');
  const record={nonce:crypto.randomUUID(),sha256:crypto.createHash('sha256').update(original.raw).digest('hex')};
  fs.writeFileSync(path.join(o.directory,'launch.initialize.claim'),JSON.stringify(record),{flag:'wx'});
  assert.deepEqual(launchFile(o).raw,original.raw,'launch changed while claiming');
  return {original,record};
}
function bindContext(o,id,claim) {
  assert(uuid.test(id));assert.deepEqual(launchFile(o).raw,claim.original.raw,'launch changed before publication');
  const record=launchFile(o,'launch.initialize.claim').value;
  assert.deepEqual(record,claim.record,'launch claim changed');
  fs.writeFileSync(path.join(o.directory,'launch.bound.message.json'),JSON.stringify({...claim.original.value,cli_session:id,launch_sha256:claim.record.sha256}),{flag:'wx'});
  assert.deepEqual(launchFile(o).raw,claim.original.raw,'launch changed during publication');
}
function boundLaunch(o) {
  const bound=launchFile(o,'launch.bound.message.json').value;
  assert(uuid.test(bound.cli_session||''));const withoutId=v=>{const {cli_session,launch_sha256,...rest}=v;return rest;};
  assert.equal(bound.launch_sha256,crypto.createHash('sha256').update(launchFile(o).raw).digest('hex'),'original launch changed');
  assert.deepEqual(withoutId(bound),withoutId(o),'bound launch differs from original');
  if(o.cli_session!==undefined)assert.equal(o.cli_session,bound.cli_session);
  return bound;
}
export async function initializeCodex(o,recipe,client,reopen=()=>connectNative({executable:o.executable,cwd:o.cwd,socket:o.socket,env:childEnvironment(process.env)})) {
  assert(Object.keys(o).every(k=>['kind','role','model','owner','instance','task_id','executable','resume','name','cwd','directory','runtime','socket','server','hub','cli_session'].includes(k)),'unsupported launch context field');
  const name=o.name??(o.role+' | '+o.task_id);
  if(!o.resume)assert(typeof name==='string'&&name.trim().length>0&&Buffer.byteLength(name)<=512&&!/[\x00-\x1f\x7f]/.test(name),'initial session name invalid');
  assert(!o.cli_session||o.resume===o.cli_session,'new launch UUID already consumed');
  const claim=claimLaunch(o);
  if(o.resume)bindContext(o,o.resume,claim);
  const configured=recipe.request.config['mcp_servers.ai_settings_sessions'];assert(configured,'MCP configuration missing');
  const r=await client.request(o.resume?'thread/resume':'thread/start',{...recipe.request,...(o.resume?{threadId:o.resume,excludeTurns:true}:{ephemeral:false,
    config:{...recipe.request.config,'mcp_servers.ai_settings_sessions':{...configured,enabled:false}}})});
  const cli_session=verifyCodex(r,o);
  if(!o.resume) {
    bindContext(o,cli_session,claim);
    // Naming materializes an empty native thread without a model turn, before its cold rebind.
    await client.request('thread/name/set',{threadId:cli_session,name});
    // Native ignores overrides on subscribed threads. Close only our initial proxy for a cold idle resume.
    await closeInspectionProxy(client,'bootstrap');
    const boundClient=await reopen();
    await withClosedProxy(boundClient,'bound',async()=>{
      const bound=await boundClient.request('thread/resume',{...recipe.request,threadId:cli_session,excludeTurns:true});
      verifyCodex(bound,{...o,resume:cli_session});
      await verifyMcp(o,cli_session,boundClient);
    });
  } else await verifyMcp(o,cli_session,client);
  return {cli_session,mcp_verified:true,...(!o.resume?{initial_name:name}:{})};
}
export async function verifyMcp(o,id,client) {
  assert(uuid.test(id),'MCP thread UUID required');
  let cursor;const seen=new Set(),rows=[];
  for(let page=0;page<4;page++) {
    const response=await client.request('mcpServerStatus/list',{threadId:id,serverName:'ai_settings_sessions',detail:'full',limit:16,...(cursor?{cursor}:{})});
    assert(Array.isArray(response?.data)&&response.data.length<=16,'MCP status unavailable');
    rows.push(...response.data);assert(rows.length<=1,'MCP registration ambiguous');
    const next=response.nextCursor;
    if(next===null||next===undefined)break;
    assert(typeof next==='string'&&next.length>0&&next.length<=512&&!seen.has(next)&&page<3,'MCP pagination invalid');
    seen.add(next);cursor=next;
  }
  const row=rows[0];assert(rows.length===1&&row.name==='ai_settings_sessions','MCP missing');
  assert(row.runtimeStatus==='connected'&&row.authStatus==='unsupported'&&row.toolsError==null,'MCP connection/discovery failed');
  assert(row.environmentId==null&&row.pluginId==null&&row.httpOrigin==null,'MCP registration source mismatch');
  assert(row.serverInfo?.name==='ai-settings-sessions'&&row.serverInfo.version==='0.1.0','MCP server identity mismatch');
  assert(row.serverCapabilities?.tools&&Array.isArray(row.resources)&&row.resources.length===0
    &&Array.isArray(row.resourceTemplates)&&row.resourceTemplates.length===0,'MCP capabilities mismatch');
  assert.deepEqual(row.toolListMeta,{'ai-settings/session-bootstrap':{version:1,vendor:'codex',instance:o.instance,owner:o.owner,task_id:o.task_id,
    cli_session:id,runtime:o.runtime,server:o.server,hub:o.hub,endpoint:'unix://'+o.socket.replaceAll('\\','/')}},'MCP bootstrap identity mismatch');
  assert(row.tools&&typeof row.tools==='object'&&!Array.isArray(row.tools),'MCP tool catalog missing');
  const actual=Object.entries(row.tools);assert(actual.length===tools.length,'MCP six tools required');
  const names=new Set();
  for(const [key,tool]of actual) {
    const expected=tools.find(t=>t.name===tool?.name);
    assert(expected&&!names.has(tool.name)&&(key===tool.name||key==='mcp__ai_settings_sessions__'+tool.name),'MCP tool name mismatch');
    names.add(tool.name);assert.deepEqual(tool.inputSchema,expected.inputSchema,'MCP tool schema mismatch');
    assert(tool._meta==null&&tool.outputSchema==null,'MCP unexpected tool metadata');
  }
}
export async function checkCodex(o,client) {
  assert(uuid.test(o.cli_session));
  const id=verifyCodex(await client.request('thread/resume',{threadId:o.cli_session,excludeTurns:true}),{...o,resume:o.cli_session});
  await verifyMcp(o,id,client);
  return {cli_session:id,mcp_verified:true};
}
export async function inspectCodex(o,recipe,mode,open=()=>connectNative({executable:o.executable,cwd:o.cwd,socket:o.socket,env:childEnvironment(process.env)})) {
  try {
    assert(mode==='--initialize'||mode==='--check');
    const client=await open();
    const result=await withClosedProxy(client,mode==='--check'?'check':o.resume?'resume':'bootstrap',
      ()=>mode==='--initialize'?initializeCodex(o,recipe,client,open):checkCodex(o,client));
    return {code:0,result:{...result,cmd:recipe.tuiArgs(result.cli_session)}};
  } catch(error) {
    const failures=[],acquisition_failures=[],seen=new Set();let verification_failed=false;
    function note(value) {
      if(seen.has(value))return;seen.add(value);
      if(value instanceof ProxyCleanupError)failures.push(value.diagnostic);
      else if(value instanceof NativeConnectError){acquisition_failures.push(value.diagnostic);verification_failed=true;}
      else if(value instanceof AggregateError)value.errors.forEach(note);
      else verification_failed=true;
    }
    note(error);let diagnostic_saved=false;
    try {
      fs.writeFileSync(path.join(o.directory,'inspection-failure-'+crypto.randomUUID()+'.json'),
        JSON.stringify({phase:mode==='--initialize'?'initialize':'check',verification_failed,acquisition_failures,cleanup_failures:failures}),{flag:'wx'});
      diagnostic_saved=true;
    }catch{}
    return {code:1,result:{error:'Owned Codex startup/identity verification failed; no automatic retry'+(diagnostic_saved?'':'; diagnostic write unavailable')}};
  }
}
export function inspectionConnector(o,mode,dependencies={}) {
  const options={executable:o.executable,cwd:o.cwd,socket:o.socket,env:childEnvironment(process.env)};
  const connect=dependencies.connect||connectNative;let first=true;
  return ()=>{
    const mayWait=first&&mode==='--initialize';first=false;
    return mayWait?waitNativeReady(options,{...dependencies,connect,record:record=>{
      fs.appendFileSync(path.join(o.directory,'readiness-attempts.jsonl'),JSON.stringify(record)+'\n');
    }}):connect(options);
  };
}
export function ownedServerExit(o,child,result) {
  return {kind:'ai-settings-owned-server-exit',wrapperPid:process.pid,childPid:child.pid??null,endpoint:'unix://'+o.socket.replaceAll('\\','/'),
    code:result.code,signal:result.signal??null,filesystemSocketState:'unverified'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [mode,file]=process.argv.slice(2);assert(['--serve','--initialize','--check'].includes(mode));
    let o=JSON.parse(fs.readFileSync(file,'utf8'));assert(o.kind==='ai-settings-codex-launch');
    assert.equal(path.resolve(file),path.join(o.directory,'launch.message.json'));
    if(mode==='--check')o=boundLaunch(o);
    const recipe=codexRecipe(o,process.env),socket=recipe.endpoint.slice(7);
    if(mode==='--serve') {
      assert(!fs.existsSync(path.dirname(socket)),'native CLI must create its private directory; never repair an existing ACL');
      const onInterrupt=()=>{};process.on('SIGINT',onInterrupt);
      const child=spawn(o.executable,recipe.serverArgs,{cwd:o.cwd,env:process.env,stdio:'inherit',windowsHide:false});
      const result=await new Promise(resolve=>{child.once('error',()=>resolve({code:null}));child.once('exit',(code,signal)=>resolve({code,signal}));});
      process.removeListener('SIGINT',onInterrupt);
      fs.writeFileSync(path.join(o.directory,'server-exit.json'),JSON.stringify(ownedServerExit(o,child,result)),{flag:'wx'});
      if(result.code!==0)process.exitCode=1;
    } else {
      const outcome=await inspectCodex(o,recipe,mode,inspectionConnector(o,mode));
      console.log(JSON.stringify(outcome.result));process.exitCode=outcome.code;
    }
  } catch {console.log(JSON.stringify({error:'Owned Codex startup/identity verification failed; no automatic retry'}));process.exitCode=1;}
}
