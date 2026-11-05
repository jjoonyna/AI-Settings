vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
vim.o.hidden, vim.o.columns, vim.o.lines = true, 160, 40
vim.env.AGENT_HUB_HOME = vim.fn.tempname()
require('config.agent.hub').setup()
local W, T = require('config.agent.workspace'), require('config.agent.terminal')
W.open(false)
local cmd = { vim.fn.exepath('node'), '-e', "process.stdin.on('data',d=>{if(d.toString().includes('/quit'))process.exit(0)});setInterval(()=>{},1000)" }
local a = assert(T.spawn({ agent = 'Codex', role = 'plan', cmd = cmd, cwd = vim.fn.getcwd() }))
local b = assert(T.spawn({ agent = 'Codex', role = 'work', cmd = { vim.fn.exepath('node'), '-e', 'setTimeout(()=>process.exit(0),1500)' }, cwd = vim.fn.getcwd(), env = { AGENT_PARENT_ID = tostring(a) } }))
local e, s = T.registry[b], W.state
assert(T.done({ id = b }):match('^OK'))
assert(vim.wait(8000, function() return not vim.api.nvim_buf_is_valid(e.buf) end, 20), 'process did not exit')
assert(vim.api.nvim_win_is_valid(s.chat) and s.selected == a and vim.api.nvim_buf_is_valid(T.registry[a].buf), 'parent and its job survive')
assert(vim.fn.jobwait({ T.registry[a].chan }, 0)[1] == -1, 'parent process alive')
pcall(vim.fn.jobstop, T.registry[a].chan)
print('PASS session close real process')
