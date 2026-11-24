vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local T=require('config.agent.terminal');local H=require('config.agent.hub');local M=require('config.agent.message_transport')
H.id='ownership';H.uid=function()return 'startup-body' end;H.valid_id=function()return true end
require('config.agent.handoff').verified_role=function()return true end
vim.fn.chansend=function()error('management must not send body/Enter to PTY')end
local id='11111111-1111-4111-8111-111111111111'
for _,field in ipairs({'task_id','role','model','cli_session','exit_code'})do
  local e={id=7,agent='Codex',role='work',model='gpt-6.1-sol',task_id='task',cli_session=id,transport={vendor='codex',cli_session=id,ready=true}}
  T.registry[7]=e;local callback
  M.execute=function(_,_,cb)callback=cb end
  assert(M.startup(e,'body'));assert(callback)
  e[field]=field=='exit_code' and 0 or 'changed';callback({state='accepted'})
  assert(e.messages[1].state=='unknown' and e.messages[1].text==nil,'stale '..field..' must not claim delivery')
  M.flush_startup(e);assert(#e.messages==1,'stale startup never replays')
end
local buf=vim.api.nvim_create_buf(false,true);vim.api.nvim_set_current_buf(buf)
vim.api.nvim_buf_set_lines(buf,0,-1,false,{'same prefix edited tail','[Pasted Content 1925 chars]'})
local e={id=8,agent='Claude',role='work',model='sonnet',task_id='task',cli_session=id,buf=buf,transport={vendor='claude',cli_session=id,ready=true,model_verified=true}}
T.registry[8]=e
local original=vim.paste;local before=vim.api.nvim_buf_get_lines(buf,0,-1,false)
assert(T.send(8,'same prefix new tail'));assert(vim.paste==original)
assert(vim.deep_equal(before,vim.api.nvim_buf_get_lines(buf,0,-1,false)))
assert(e.messages[1].state=='pending','user draft does not affect inbox delivery')
print('PASS startup-ownership: stale task/role/model/UUID/exit, startup once, draft and paste handler untouched, no PTY/Enter')
