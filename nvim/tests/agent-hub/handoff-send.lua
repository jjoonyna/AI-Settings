vim.opt.rtp:prepend(vim.fn.stdpath('config'))
local T=require('config.agent.terminal');local M=require('config.agent.message_transport');local H=require('config.agent.hub')
H.id='handoff-send';H.valid_id=function()return true end;local seq=0;H.uid=function()seq=seq+1;return 'send-'..seq end
require('config.agent.handoff').verified_role=function()return true end
local buf=vim.api.nvim_create_buf(false,true)
local id='11111111-1111-4111-8111-111111111111'
local e={id=7,buf=buf,agent='Codex',role='work',model='gpt-6.1-sol',task_id='task',cli_session=id,transport={vendor='codex',cli_session=id,ready=true}}
T.registry[7]=e
vim.fn.chansend=function()error('handoff body or Enter reached PTY')end
local calls={};M.execute=function(_,q,cb)calls[#calls+1]={q=q,cb=cb}end
for _,draft in ipairs({'same prefix edited tail','[Pasted Content 1925 chars]','unrelated user draft'})do
  vim.api.nvim_buf_set_lines(buf,0,-1,false,{'› '..draft})
  local before=vim.api.nvim_buf_get_lines(buf,0,-1,false)
  assert(T.send(7,'관리 본문\nsecond line'));local c=calls[#calls];assert(c.q.text=='관리 본문\nsecond line')
  c.cb({state='unknown'});assert(c.q.state=='unknown' and c.q.text==nil)
  assert(vim.deep_equal(before,vim.api.nvim_buf_get_lines(buf,0,-1,false)))
end
assert(#calls==3,'unknown sends never replay')
for _,field in ipairs({'cli_session','task_id','agent'})do
  local old=e[field];e[field]=nil;assert(not T.send(7,'unbound'));e[field]=old
end
e.transport.ready=false;assert(not T.send(7,'not ready'));e.transport.ready=true
e.exit_code=0;assert(not T.send(7,'ended'))
print('PASS handoff-send: API-only multiline management, identical draft, no PTY/Enter, unknown no replay, missing identity/unsupported/ended refusal')
