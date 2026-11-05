vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local T = require('config.agent.terminal')
if vim.v.servername == '' then vim.fn.serverstart() end
vim.env.NVIM = 'stale-parent'
vim.env.AGENT_SESSION_MODEL = 'stale'; vim.env.AGENT_SESSION_TITLE = 'stale'; vim.env.AGENT_PARENT_ID = '99'
local output = vim.fn.tempname()
local js = 'require("fs").writeFileSync(process.argv[1],JSON.stringify(process.env))'
local id = assert(T.spawn({ agent = 'test', resume = 'resume', cwd = vim.fn.getcwd(), cmd = { vim.fn.exepath('node'), '-e', js, output } }))
assert(vim.wait(5000, function() return vim.fn.filereadable(output) == 1 end))
local env = vim.json.decode(table.concat(vim.fn.readfile(output), '\n'))
vim.fn.delete(output)
assert(env.AGENT_SESSION_ID == tostring(id))
assert(env.NVIM == vim.v.servername, 'resumed job must use the current Neovim server')
assert(not env.AGENT_SESSION_MODEL and not env.AGENT_SESSION_TITLE and not env.AGENT_PARENT_ID)
print('resume environment passed')
