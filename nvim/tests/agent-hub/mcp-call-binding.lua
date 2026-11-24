vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local C=require('config.agent.connection');local T=require('config.agent.terminal');local H=require('config.agent.hub')
local dir=vim.fn.tempname();vim.fn.mkdir(dir,'p');vim.fn.writefile({'{}'},dir..'/launch.message.json');vim.fn.writefile({'{}'},dir..'/launch.bound.message.json')
H.id='call-test';H.root=function()return dir end
require('config.agent.policy').installation=function()return {runtime=dir}end
require('config.agent.handoff').verified_role=function()return true end
local id='11111111-1111-4111-8111-111111111111'
local e={id=4,task_id='task',parent_id=1,agent='Codex',role='work',model='gpt-6.1-sol',cwd=dir,cli_session=id,buf=vim.api.nvim_get_current_buf()}
local transport={vendor='codex',ready=true,mcp_verified=true,cli_session=id,expected_cli=id,endpoint='unix://synthetic',manifest=dir..'/launch.message.json',executable=vim.v.progpath}
e.transport=transport;T.registry[4]=e
local b={server=vim.v.servername,instance=H.id,owner=4,task_id='task',parent_id=1,vendor='codex',cli_session=id}
local guard={role=e.role,model=e.model,cwd=dir,transport={context=dir..'/launch.bound.message.json',cli_session=id,endpoint=transport.endpoint,runtime=dir,hub=dir,executable=vim.v.progpath}}
local mutations=0;_G.AgentReceiveReport64=function()mutations=mutations+1;return 'OK' end
local function call(g)return C.invoke({binding=b,action='report',payload={owner=4,task_id='task',parent_id=1,text='synthetic',session_tools=g}})end
assert(call(guard)=='OK' and mutations==1)
for _,key in ipairs({'ready','mcp_verified'})do transport[key]=false;assert(call(guard):match('^FAIL:'),key);transport[key]=true end
for _,key in ipairs({'cli_session','expected_cli','endpoint','manifest','executable'})do
  local old=transport[key];transport[key]='wrong';assert(call(guard):match('^FAIL:'),key);transport[key]=old
end
for _,key in ipairs({'context','cli_session','endpoint','runtime','hub','executable'})do
  local old=guard.transport[key];guard.transport[key]='wrong';assert(call(guard):match('^FAIL:'),'guard '..key);guard.transport[key]=old
end
local missing=vim.deepcopy(guard);missing.transport=nil;assert(call(missing):match('^FAIL:'))
assert(mutations==1,'no public mutation after post-check failure or stale transport')
vim.fn.delete(dir,'rf');print('PASS MCP call binding: current ready/attested transport on each guarded host invocation')
