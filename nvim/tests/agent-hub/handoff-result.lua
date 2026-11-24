vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local T=require('config.agent.terminal');local P=require('config.agent.policy');local M=require('config.agent.handoff')
local doc=vim.fn.tempname()..'.md';vim.fn.writefile({'# synthetic'},doc)
-- Formatter/uncertain-outcome harness; installed STDIO tests cover real bridge allocation and guards.
P.validate=function()return {id='gpt-6-luna'}end;P.command=function()return {vim.v.progpath}end
M.verified_role=function()return true end
T.registry[1]={id=1,role='plan',model='gpt-6.1-sol',buf=vim.api.nvim_get_current_buf()}
local input={agent='codex',session='work',name='title with spaces',goal='g',scope='s',validation='v',prompt='p',
  spec_doc=doc,plan_doc=doc,cwd=vim.fn.getcwd(),parent_id=1,parent_server=vim.v.servername,parent_model='gpt-6.1-sol'}
for _,mode in ipairs({'failed','missing','invalid','success'})do
  local calls=0;T.registry[21]=nil
  T.spawn=function()
    calls=calls+1;if mode=='failed' then return nil,'synthetic launch failure' end
    if mode~='missing' then T.registry[21]={task_id=mode=='invalid' and '' or 'actual-created-task'} end
    return 21
  end
  local result=M.receive(input);assert(calls==1,'no handoff retry')
  if mode=='failed' then assert(result=='FAIL: synthetic launch failure')
  elseif mode~='success' then assert(result:find('do not retry',1,true) and not result:find('OK id=',1,true))
  else assert(result=='OK id=21 model=gpt-6-luna title=작업 | title with spaces task_id=actual-created-task') end
end
vim.fn.delete(doc);print('PASS handoff result: actual registry task suffix, old prefix, failed/uncertain one attempt')
