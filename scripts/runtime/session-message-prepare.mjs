import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {childEnvironment} from './session-message-rpc.mjs';
import {codexRecipe} from './session-codex.mjs';
export function prepare(o,version) {
  assert(['claude','codex'].includes(o.vendor));
  assert(['plan','work','review'].includes(o.role)&&typeof o.model==='string'&&o.model.length>0);
  assert(Number.isSafeInteger(o.owner)&&o.owner>0&&typeof o.task_id==='string'&&typeof o.instance==='string');
  assert(Array.isArray(o.cmd)&&o.cmd.length>0&&path.isAbsolute(o.executable)&&path.isAbsolute(o.cwd)&&path.isAbsolute(o.directory));
  if(o.vendor==='codex'&&/\.(?:cmd|ps1)$/i.test(o.executable)) {
    assert(/^codex\.(?:cmd|ps1)$/i.test(path.basename(o.executable)),'unsupported native launcher');
    const arch=process.arch==='arm64'?'aarch64':'x86_64';
    const base=path.join(path.dirname(o.executable),'node_modules/@openai/codex');
    const candidates=[path.join(base,'node_modules/@openai',`codex-win32-${process.arch}`,`vendor/${arch}-pc-windows-msvc/bin/codex.exe`),path.join(base,`vendor/${arch}-pc-windows-msvc/bin/codex.exe`)];
    const executable=candidates.find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());assert(executable,'selected npm launcher native executable unavailable');
    o={...o,executable};
  }
  const cli_session=o.resume;
  if(cli_session)assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(cli_session));
  const v=version??spawnSync(o.executable,['--version'],{env:childEnvironment(process.env),encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true,timeout:5000,maxBuffer:4096}).stdout;
  assert(o.vendor==='codex'?/^codex-cli 0\.172\.0\s*$/.test(v||''):/\b2\.1\.331\b/.test(v||''),'verified native CLI version is required');
  fs.mkdirSync(o.directory,{recursive:true});const dir=fs.mkdtempSync(path.join(o.directory,'message-'));
  if(o.vendor==='codex') {
    const runtime=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    // Native CLI creates the short current-user TEMP directory with its own protected DACL.
    const socket=path.join(os.tmpdir(),'aism-'+crypto.randomBytes(8).toString('hex'),'c.sock');
    assert(!fs.existsSync(path.dirname(socket)));
    assert(typeof process.env.NVIM==='string'&&path.isAbsolute(process.env.AGENT_HUB_HOME||''),'exact MCP host/hub required');
    const launch={kind:'ai-settings-codex-launch',...Object.fromEntries(['role','model','owner','instance','task_id','executable','resume','name'].filter(k=>o[k]!==undefined).map(k=>[k,o[k]])),cwd:fs.realpathSync(o.cwd),directory:dir,runtime,socket,
      server:process.env.NVIM,hub:path.resolve(process.env.AGENT_HUB_HOME)};
    const recipe=codexRecipe(launch,process.env),manifest=path.join(dir,'launch.message.json');
    fs.writeFileSync(manifest,JSON.stringify(launch),{flag:'wx'});
    return {role:o.role,model:o.model,manifest,server_cmd:[process.execPath,fileURLToPath(new URL('./session-codex.mjs',import.meta.url)),'--serve',manifest],
      transport:{vendor:'codex',ready:false,endpoint:recipe.endpoint,executable:o.executable,manifest}};
  }
  const manifest=path.join(dir,'launch.message.json'),settings=path.join(dir,'settings.json');
  const m={kind:'ai-settings-message-launch',vendor:o.vendor,cli_session:cli_session||crypto.randomUUID(),
    instance:o.instance,owner:o.owner,task_id:o.task_id,role:o.role,model:o.model,resume:!!cli_session,cwd:fs.realpathSync(o.cwd)};
  const script=fileURLToPath(new URL('./session-inbox.mjs',import.meta.url));
  const quote=s=>{assert(!/["'`$%!?&|<>^\r\n]/.test(s));return '"'+s.replaceAll('\\','/')+'"';};
  const command=[process.execPath,script,manifest].map(quote).join(' ');
  const hooks={hooks:{SessionStart:[{hooks:[{type:'command',command,async:true}]}],SessionEnd:[{hooks:[{type:'command',command,timeout:15}]}]}};
  fs.writeFileSync(manifest,JSON.stringify(m),{flag:'wx'});fs.writeFileSync(settings,JSON.stringify(hooks),{flag:'wx'});
  if(cli_session)assert(o.cmd[1]==='--continue'||(o.cmd[1]==='--resume'&&o.cmd[2]===cli_session),'exact managed resume command required');
  const cmd=cli_session?[o.executable,'--resume',cli_session,...o.cmd.slice(o.cmd[1]==='--continue'?2:3)]:[o.executable,...o.cmd.slice(1)];
  const modelAt=cmd.indexOf('--model');
  if(modelAt>=0)assert.equal(cmd[modelAt+1],o.model,'CLI model mismatch');else cmd.push('--model',o.model);
  const permissionAt=cmd.indexOf('--permission-mode');
  if(o.role==='review') {
    if(permissionAt>=0)assert.equal(cmd[permissionAt+1],'bypassPermissions');else cmd.push('--permission-mode','bypassPermissions');
  }
  if(!cli_session)cmd.push('--session-id',m.cli_session);
  const managedMcp=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../claude-mcp.json');
  if(!cmd.includes(managedMcp))cmd.push('--mcp-config',managedMcp);
  cmd.push('--settings',settings);
  return {cmd,transport:{vendor:o.vendor,expected_cli:m.cli_session,ready:false},role:o.role,model:o.model,manifest};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{let raw='';for await(const c of process.stdin){raw+=c;assert(Buffer.byteLength(raw)<=65536);}console.log(JSON.stringify(prepare(JSON.parse(raw))));}
  catch{console.log(JSON.stringify({error:'Managed transport startup unavailable; verify exact role/model/version and owned-server lifecycle'}));process.exitCode=1;}
}
