vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local P=require('config.agent.policy');local H=require('config.agent.hub');local T=require('config.agent.terminal')
local M=require('config.agent.message_transport');local handoff=require('config.agent.handoff');local A=require('config.agent.activity')
local root=vim.fn.tempname();vim.fn.mkdir(root..'/bin','p');vim.fn.writefile(vim.fn.readfile('scripts/runtime/session-role.mjs','b'),root..'/bin/session-role.mjs','b')
local hub=root..'/hub';vim.fn.mkdir(hub,'p');H.id='role-order';H.root=function()return hub end;H.publish=function()end
package.loaded['config.agent.workspace']={refresh=function()end}
P.installation=function()return {runtime=root,mode='both'}end
local serial=0;H.uid=function()serial=serial+1;return 'message-'..serial end
local original=vim.system;local next_id;local response_patch
vim.system=function(cmd,opts,...)
 if cmd[2]==root..'/bin/session-message-prepare.mjs' then
  local request=vim.json.decode(opts.stdin)
  local value={cmd={'claude','--session-id',next_id},role=request.role,model=request.model,manifest=hub..'/launch.message.json',transport={vendor='claude',expected_cli=next_id,ready=false}}
  if response_patch then response_patch(value)end
  return {wait=function()return {code=0,stdout=vim.json.encode(value)}end}
 end
 return original(cmd,opts,...)
end
local case=0
local function prepare(task)
 local env={AGENT_SESSION_ID='4',AGENT_TASK_ID=task or 'task',AGENT_EVENT_INSTANCE=H.id}
 return M.prepare({agent='Claude',cmd={'claude'},cwd=vim.fn.getcwd(),role='plan',model='opus'},env)
end
local function new_id()case=case+1;next_id=string.format('%08x-1111-4111-8111-111111111111',case);return next_id end
for _,activity_first in ipairs({true,false})do for _,order in ipairs({{'bind-inbox','model-attest'},{'model-attest','bind-inbox'}})do
 local id=new_id();assert(not handoff.verified_role({agent='Claude',cli_session=id,role='plan'}),'fresh store initially absent')
 local value=assert(prepare());assert(handoff.verified_role({agent='Claude',cli_session=id,role='plan'}),'assigned role must exist BEFORE any native callback')
 local now=os.time()*1000;local e={id=4,agent='Claude',role='plan',model='opus',task_id='task',cli_session=id,event_token='synthetic',event_started=now-1000,cwd=vim.fn.getcwd(),transport=value.transport};T.registry[4]=e
 local identity={instance=H.id,owner=4,task_id='task',vendor='claude',cli_session=id,token=e.event_token}
 local function call(op)return M.receive({operation=op,identity=identity,role=e.role,model=op=='model-attest' and 'opus' or nil})end
 local function activity()assert(A.receive({instance=H.id,owner=4,token=e.event_token,at=now,cli_session=id,event='SessionStart',status='idle',source='claude:SessionStart'}):match('^OK'))end
 assert(not e.transport.ready and not e.transport.model_verified);assert(M.startup(e,'synthetic body'))
 if activity_first then activity()end
 assert(call(order[1]).ok);assert(not e.transport.ready and #(e.messages or {})==0,'role alone/one signal cannot send')
 assert(call(order[2]).ok);assert(e.transport.ready and #e.messages==1 and e.startup.claimed)
 if not activity_first then activity()end
 assert(call('model-attest').ok and #e.messages==1);local body=call('take');assert(body.message.text=='synthetic body');assert(not call('take').message)
 local stale=vim.deepcopy(identity);stale.task_id='old-task';assert(not M.receive({operation='model-attest',identity=stale,role='plan',model='opus'}).ok)
 assert(not M.receive({operation='model-attest',identity=identity,role='plan',model='haiku'}).ok);assert(not e.transport.ready);assert(not call('model-attest').ok)
 -- A new generation with the same UUID is distinct; old task/token cannot attest it.
 local fresh=assert(prepare('new-task'));local replacement={id=4,agent='Claude',role='plan',model='opus',task_id='new-task',cli_session=id,event_token='new-synthetic',transport=fresh.transport};T.registry[4]=replacement
 assert(not M.receive({operation='model-attest',identity=identity,role='plan',model='opus'}).ok);assert(not fresh.transport.ready and not fresh.transport.model_verified)
 T.registry[4]=nil
end end
-- A role removed after trusted preparation does not get recreated by a callback.
local removed=new_id();local prepared=assert(prepare());vim.fn.delete(root..'/state/session-roles/claude/'..removed..'.json')
T.registry[4]={id=4,agent='Claude',role='plan',model='opus',task_id='task',cli_session=removed,event_token='removed',transport=prepared.transport}
assert(not M.receive({operation='bind-inbox',identity={instance=H.id,owner=4,task_id='task',vendor='claude',cli_session=removed,token='removed'},role='plan'}).ok)
assert(prepared.transport.model_failed and not vim.uv.fs_stat(root..'/state/session-roles/claude/'..removed..'.json'));T.registry[4]=nil
-- Existing conflicting or malformed role is never overwritten.
for _,invalid in ipairs({false,true})do
 local id=new_id();local path=root..'/state/session-roles/claude/'..id..'.json'
 if invalid then vim.fn.writefile({'{invalid'},path)
 else local saved,ok=handoff.save_role({agent='Claude',cli_session=id},'review');assert(ok and saved=='review')end
 local before=vim.fn.readfile(path,'b');assert(not prepare());assert(vim.deep_equal(before,vim.fn.readfile(path,'b')))
end
-- Wrong prepared identity/role/model is refused without creating a role.
for _,patch in ipairs({function(v)v.transport.expected_cli='bad'end,function(v)v.role='work'end,function(v)v.model='haiku'end})do
 local id=new_id();response_patch=patch;assert(not prepare());response_patch=nil
 assert(not vim.uv.fs_stat(root..'/state/session-roles/claude/'..id..'.json'))
end
local blocked=root..'/blocked';vim.fn.mkdir(blocked..'/bin','p');vim.fn.writefile(vim.fn.readfile('scripts/runtime/session-role.mjs','b'),blocked..'/bin/session-role.mjs','b');vim.fn.writefile({'not a directory'},blocked..'/state')
-- Keep the prepare stub on the original runtime, but make the real role API fail its write.
local install_calls=0;P.installation=function()install_calls=install_calls+1;return {runtime=install_calls==1 and root or blocked,mode='both'}end
new_id();assert(not prepare(),'role store failure must stop before launch')
vim.system=original;vim.fn.delete(root,'rf')
print('PASS real role store: assigned before callbacks; activity both orders; no body before role+model+inbox; once; wrong/malformed/store failure/stale rejected')
