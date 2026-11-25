vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local paste, writes, failures, calls = vim.paste, {}, {}, {}
package.loaded['config.agent.message_transport'] = {
  send=function(e,text,opts) calls[#calls+1]={owner=e.id,text=text,opts=opts};return true,nil,{state='pending',id='message-1'} end,
  startup=function(e,text,name) calls[#calls+1]={owner=e.id,text=text,name=name,startup=true};return true end,
  control=function() return false,'unsupported normal control' end,
}
local T=require('config.agent.terminal')
local buf=vim.api.nvim_create_buf(false,true)
vim.api.nvim_buf_set_lines(buf,0,-1,false,{'› same prefix edited tail','[Pasted Content 1925 chars]'})
local before=vim.api.nvim_buf_get_lines(buf,0,-1,false)
local chansend,defer=vim.fn.chansend,vim.defer_fn
vim.fn.chansend=function(_,value) writes[#writes+1]=value;return #value end
vim.defer_fn=function(fn) fn() end
local function check(name,fn) local ok,err=pcall(fn);if not ok then failures[#failures+1]=name..': '..tostring(err) end end
T.registry[771]={id=771,buf=buf,chan=772,agent='Codex',role='work',task_id='task',cli_session='11111111-1111-4111-8111-111111111111'}
check('no global input heuristic',function()assert(vim.paste==paste,'transport must not replace vim.paste')end)
check('pre-existing same prefix/paste length receives no PTY body or Enter',function()
  assert(T.send(771,'same prefix new tail',{max_tries=1}));assert(#writes==0,'body/Enter reached PTY')
  assert(#calls==1 and calls[1].text=='same prefix new tail');assert(vim.deep_equal(before,vim.api.nvim_buf_get_lines(buf,0,-1,false)))
end)
check('normal control never queues /quit and never force kills',function()
  local n=#writes;local result=T.done({id=771});assert(result:find('FAIL:',1,true));assert(#writes==n,'done used a PTY control body')
end)
local hub=require('config.agent.hub');hub.note=function(e)e.task_id='startup';e.note='note'end;hub.publish=function()end
T.spawn=function()T.registry[771]={id=771,buf=buf,chan=772,task_id='startup',role='work'};return 771 end
T.wait_ready=function()error('startup must wait on exact API/hook readiness, not a screen prompt')end
require('config.agent.bridge').install(T)
check('new startup sends briefing once without rename body or manual Enter',function()
  calls={};assert(T.spawn({agent='Codex',cmd={'codex'},cwd=vim.fn.getcwd(),session_name='작업 | test',briefing='startup body'})==771)
  assert(#calls==1 and calls[1].startup and calls[1].text=='startup body' and calls[1].name=='작업 | test');assert(#writes==0)
end)
vim.fn.chansend,vim.defer_fn=chansend,defer
assert(#failures==0,table.concat(failures,'\n'))
print('PASS message-transport: untouched draft, no PTY/Enter, no rename body, startup once, unsupported control fails closed')
