vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local C=require('config.agent.connection');local T=require('config.agent.terminal');local H=require('config.agent.hub')
local dir=vim.fn.tempname();vim.fn.mkdir(dir,'p');H.id='claude-call'
require('config.agent.handoff').verified_role=function()return true end
local id='11111111-1111-4111-8111-111111111111'
local e={id=4,task_id='task',parent_id=1,agent='Claude',role='work',model='sonnet',cwd=dir,cli_session=id,buf=vim.api.nvim_get_current_buf()}
local transport={vendor='claude',ready=true,ready_claimed=true,model_verified=true,cli_session=id,expected_cli=id};e.transport=transport;T.registry[4]=e
local b={server=vim.v.servername,instance=H.id,owner=4,task_id='task',parent_id=1,vendor='claude',cli_session=id}
local guard={role=e.role,model=e.model,cwd=dir,inbox={cli_session=id}}
local mutations=0;_G.AgentReceiveReport64=function()mutations=mutations+1;return 'OK' end
local function call(g,action)return C.invoke({binding=b,action=action or 'report',payload={owner=4,task_id='task',parent_id=1,text='synthetic',session_tools=g}})end
assert(call(guard)=='OK' and mutations==1)
for _,key in ipairs({'ready','ready_claimed','model_verified','expected_cli','cli_session','vendor'})do
  local old=transport[key];transport[key]=false
  assert(call(guard):match('^FAIL:'),key);assert(call(guard,'status'):match('^FAIL:'),'status '..key);transport[key]=old
end
local missing=vim.deepcopy(guard);missing.inbox=nil;assert(call(missing):match('^FAIL:'))
guard.inbox.cli_session='22222222-2222-4222-8222-222222222222';assert(call(guard):match('^FAIL:'));guard.inbox.cli_session=id
e.transport=nil;assert(call(guard):match('^FAIL:'));e.transport=transport
e.cli_session='22222222-2222-4222-8222-222222222222';assert(call(guard):match('^FAIL:'));e.cli_session=id
assert(mutations==1,'not-ready/end/stale UUID cannot invoke report')
vim.fn.delete(dir,'rf');print('PASS Claude call binding: UUID-only owned-inbox proof and current ready/claimed/bound lifecycle')
