vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local H,T,P = require('config.agent.hub'),require('config.agent.terminal'),require('config.agent.policy')
H.id = 'tools-test'
H.root = function() return arg[2] .. '/state/tools-test' end
P.installation = function() return {runtime=arg[2],models=arg[2] .. '/models.json',mode=arg[4]=='claude' and 'both' or 'codex'} end
T.registry = {
  [1]={id=1,buf=vim.api.nvim_get_current_buf(),task_id='parent',role='plan',model='gpt-6.1-sol',agent='Codex',cwd=arg[3],cli_session='12345678-1234-1234-1234-123456789abc'},
  [2]={id=2,buf=vim.api.nvim_get_current_buf(),task_id='child',parent_id=1,role='work',model='gpt-6-luna',agent='Codex',cwd=arg[3],cli_session='87654321-1234-1234-1234-123456789abc'},
  [3]={id=3,buf=vim.api.nvim_get_current_buf(),task_id='unrelated',parent_id=9,role='work',model='gpt-6-luna',agent='Codex',cwd=arg[3]},
}
local count = 0
local claude=arg[4]=='claude'
if claude then
  T.registry[1].agent,T.registry[1].model='Claude','opus'
  T.registry[2].agent,T.registry[2].model='Claude','sonnet'
end
T.spawn = function(opts)
  assert(opts.model == (claude and 'sonnet' or 'gpt-6-luna') and opts.role == 'work' and opts.cwd == arg[3])
  assert(not vim.tbl_contains(opts.cmd,'--no-daemon'),'managed preparation chooses explicit private native endpoint')
  count = count + 1
  local id=20+count
  T.registry[id]={id=id,buf=vim.api.nvim_create_buf(false,true),agent=opts.agent,cwd=opts.cwd,role=opts.role,model=opts.model,
    task_id=opts.env.AGENT_TASK_ID,parent_id=tonumber(opts.env.AGENT_PARENT_ID)}
  return id
end
require('config.agent.bridge').install(T)
require('config.agent.connection').setup()
if arg[5] then
  local connection=require('config.agent.connection');local invoke=connection.invoke
  connection.invoke=function(request)
    local transports=vim.json.decode(table.concat(vim.fn.readfile(arg[5]),'\n'))
    for key,value in pairs(transports)do
      T.registry[tonumber(key)].transport=value
      if claude then T.registry[tonumber(key)].cli_session=value.cli_session end
    end
    return invoke(request)
  end
end
require('config.agent.handoff')
T.send = function() return true end
package.loaded['config.agent.workspace'] = {refresh=function() end}
_G.AgentTaskComplete64 = function(value)
  return require('config.agent.reviews').complete(vim.json.decode(vim.base64.decode(value)))
end
vim.fn.writefile({'ready'},arg[1])
vim.wait(60000,function() return false end,20)
vim.cmd('qa!')
