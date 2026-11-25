import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {spawnSync} from 'node:child_process';
test('PowerShell wrapper AST establishes process-local UTF8 before input, with no execution-policy modification',()=>{
 const file=path.resolve('claude/statusline-command.ps1'),source=fs.readFileSync(file,'utf8');
 assert(!/ExecutionPolicy|Bypass|Invoke-Expression/i.test(source));
 // ParseFile reads syntax only; it neither executes nor dot-sources the policy-blocked script.
 const command="$tokens=$null;$errors=$null;$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:AI_SETTINGS_PARSE_FILE,[ref]$tokens,[ref]$errors);[Console]::Write($errors.Count)";
 const result=spawnSync('powershell',['-NoProfile','-Command',command],{env:{...process.env,AI_SETTINGS_PARSE_FILE:file},encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'0');
 const read=source.indexOf('[Console]::In.ReadToEnd()');
 for(const assignment of ['[Console]::InputEncoding = $utf8','$OutputEncoding = $utf8','[Console]::OutputEncoding = $utf8'])assert(source.indexOf(assignment)>=0&&source.indexOf(assignment)<read);
 assert(source.includes('[System.Text.UTF8Encoding]::new($false)'));
});
test('Unicode JSON and display cross the actual Node statusline boundary without weakening cwd/model equality',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'status-unicode-')),cwd=path.join(root,'한글 작업');fs.mkdirSync(cwd);
 try{const data={session_id:'11111111-1111-4111-8111-111111111111',cwd,model:{id:'claude-opus-4-7',display_name:'한글 모델'}};
 const result=spawnSync(process.execPath,['scripts/runtime/statusline.mjs'],{input:Buffer.from(JSON.stringify(data),'utf8'),encoding:'utf8',env:{...process.env,AI_SETTINGS_HOME:root,AI_SETTINGS_CLAUDE_LAUNCH:''}});
 assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('한글 모델'));assert(result.stdout.includes('한글 작업'));assert(!result.stdout.includes('\uFFFD'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
