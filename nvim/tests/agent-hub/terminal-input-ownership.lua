-- Run with -c "lua dofile('nvim/tests/agent-hub/terminal-input-ownership.lua')".
-- -l/vim.wait does not enter the main terminal-input loop.
vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local T=require('config.agent.terminal')
local paste=vim.paste
local buf=vim.api.nvim_create_buf(false,true)
vim.api.nvim_set_current_buf(buf)
local inputs={}
vim.api.nvim_open_term(buf,{on_input=function(_,_,_,data) inputs[#inputs+1]=data end})
T.registry[999]={buf=buf,send_token={}}
local function checked(fn)
  return function()
    local ok,error=pcall(fn)
    if not ok then io.stderr:write(tostring(error));vim.cmd('cquit 1') end
  end
end
vim.cmd('startinsert')
vim.defer_fn(checked(function()
  assert(vim.api.nvim_get_mode().mode=='t','main loop must enter terminal mode')
  vim.api.nvim_input('X')
  vim.defer_fn(checked(function()
    assert(vim.paste==paste,'management must preserve the user paste handler')
    assert(table.concat(inputs):find('X',1,true),'key must reach terminal input')
    T.registry[999].send_token={}
    assert(vim.api.nvim_paste('replacement',false,-1))
    assert(vim.paste==paste,'management must preserve the user paste handler')
    assert(table.concat(inputs):find('replacement',1,true),'paste must reach terminal input')
    print('PASS terminal-input-ownership: real terminal keys/paste remain available; management installs no input heuristic')
    vim.cmd('qa!')
  end),100)
end),100)
