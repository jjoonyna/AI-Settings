vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local H,T = require('config.agent.hub'),require('config.agent.terminal')
H.id = 'rpc-test'
T.registry = {[1]={id=1,buf=vim.api.nvim_get_current_buf(),task_id='rpc-task',agent='Codex',
  cli_session='12345678-1234-1234-1234-123456789abc'},
  [2]={id=2,buf=vim.api.nvim_get_current_buf(),task_id='rpc-task',parent_id=1},
  [7]={id=7,buf=vim.api.nvim_get_current_buf(),task_id='parent-task'},
  [8]={id=8,buf=vim.api.nvim_get_current_buf(),task_id='child-task',parent_id=7,agent='Codex',
    cli_session='87654321-1234-1234-1234-123456789abc'}}
require('config.agent.connection').setup()
local count = 0
_G.AgentUserReview64 = function(value)
  count = count + 1
  return 'OK ' .. vim.json.encode({count=count,payload=vim.json.decode(vim.base64.decode(value))})
end
_G.AgentReceiveReport64 = function(value)
  count = count + 1
  return 'OK ' .. vim.json.encode({count=count,payload=vim.json.decode(vim.base64.decode(value))})
end
vim.fn.writefile({'ready'},arg[1])
vim.wait(60000,function() return false end,20)
vim.cmd('qa!')
