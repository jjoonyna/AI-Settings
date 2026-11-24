vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local T = require('config.agent.terminal')
if vim.v.servername == '' then vim.fn.serverstart() end
vim.env.NVIM = 'stale-parent'
vim.env.AGENT_SESSION_MODEL = 'stale'; vim.env.AGENT_SESSION_TITLE = 'stale'; vim.env.AGENT_PARENT_ID = '99'
local output = vim.fn.tempname()
local js = 'require("fs").writeFileSync(process.argv[1],JSON.stringify(Object.fromEntries(["NVIM","AGENT_SESSION_ID","AGENT_SESSION_MODEL","AGENT_SESSION_TITLE","AGENT_PARENT_ID"].map(k=>[k,process.env[k]]))))'
local id = assert(T.spawn({ agent = 'test', resume = 'resume', cwd = vim.fn.getcwd(), cmd = { vim.fn.exepath('node'), '-e', js, output } }))
assert(vim.wait(5000, function() return vim.fn.filereadable(output) == 1 end))
local env = vim.json.decode(table.concat(vim.fn.readfile(output), '\n'))
vim.fn.delete(output)
assert(env.AGENT_SESSION_ID == tostring(id))
assert(env.NVIM == vim.v.servername, 'resumed job must use the current Neovim server')
assert(not env.AGENT_SESSION_MODEL and not env.AGENT_SESSION_TITLE and not env.AGENT_PARENT_ID)
local P = require('config.agent.policy')
assert(not vim.tbl_contains(P.command('codex','plan','gpt-6.1-sol'),'--no-daemon'))
assert(not vim.tbl_contains(P.resume_command('codex','resume','12345678-1234-1234-1234-123456789abc'),'--no-daemon'))
assert(not vim.tbl_contains(P.resume_command('codex','continue'),'--no-daemon'))
assert(not vim.tbl_contains(P.command('claude','plan','opus'),'--no-daemon'))
print('resume environment passed')
