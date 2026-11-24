vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local T=require('config.agent.terminal');local H=require('config.agent.hub');local M=require('config.agent.message_transport')
H.id='message-test';H.uid=function()return 'exact-message'end
require('config.agent.handoff').save_role=function(_,r)return r,true end
require('config.agent.handoff').verified_role=function()return true end
M.execute=function()end
local e={id=1,agent='Codex',role='work',model='gpt-6.1-sol',task_id='task',event_token='synthetic',cwd=vim.fn.getcwd(),
  transport={vendor='codex',ready=false,mcp_verified=true,expected_cli='11111111-1111-4111-8111-111111111111',endpoint='unix://C:/synthetic/control.sock',executable='C:/synthetic/codex.exe'}} -- Synthetic completed native check for the RPC claim fixture.
T.registry[1]=e;M.startup(e,'body')
local done=false;local original=_G.AgentMessage64
_G.AgentMessage64=function(value)
  local request=vim.json.decode(vim.base64.decode(value));local result=original(value)
  if request.operation=='end' then done=true end
  return result
end
io.stdout:write('READY\n');io.stdout:flush()
vim.wait(10000,function()return done end,10)
vim.cmd('qa!')
