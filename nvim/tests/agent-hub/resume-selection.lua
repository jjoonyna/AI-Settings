vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local P = require('config.agent.policy')
local role_root = vim.fn.tempname()
vim.fn.mkdir(role_root .. '/bin', 'p')
vim.fn.writefile(vim.fn.readfile('scripts/runtime/session-role.mjs', 'b'), role_root .. '/bin/session-role.mjs', 'b')
P.installation = function() return { mode = 'both', runtime = role_root } end
vim.system({ 'node', role_root .. '/bin/session-role.mjs', 'save', 'codex', '12345678-1234-1234-1234-123456789abc', 'plan' }, { env = { AI_SETTINGS_HOME = role_root } }):wait()
P.catalog = function() return { models = { { id = 'gpt-6.1-sol', vendor = 'codex' } } } end
local T = require('config.agent.terminal')
local H = require('config.agent.hub')
local A = require('config.agent.activity')
local saved = { id = '12345678-1234-1234-1234-123456789abc', title = '계획 | 선택', role = 'plan', model = 'gpt-6.1-sol' }
local id = assert(T.spawn({ agent = 'Codex', resume = 'resume', saved = saved, name = saved.title,
  cwd = vim.fn.getcwd(), cmd = { vim.fn.exepath('node'), '-e', 'setTimeout(()=>{}, 5000)' } }))
local e = T.registry[id]
assert(e.cli_session == saved.id and e.name == saved.title and e.role == saved.role and e.model == saved.model)
assert(T.display_name(e) == saved.title and e.status == 'unknown')
local event = { owner = id, instance = H.id, token = e.event_token, at = e.event_started + 1,
  cli_session = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', event = 'UserPromptSubmit', status = 'working' }
assert(A.receive(event):match('^FAIL') and e.status == 'unknown')
event.cli_session = saved.id
assert(A.receive(event):match('^OK') and e.status == 'working')
event.at = event.at + 1; event.event = 'PermissionRequest'; event.status = 'response_requested'
assert(A.receive(event):match('^OK') and e.status == 'response_requested' and A.labels[e.status] == '응답 요청')
local row = H.snapshot().entries[1]
assert(row.id == id and row.status == 'response_requested' and row.name == saved.title)
vim.fn.jobstop(e.chan)
local M = require('config.agent.menu')
local W = require('config.agent.workspace')
local pick, spawn, open, command, resume = M.pick, T.spawn, W.open, M.cmd_for, P.resume_command
local captured
W.open = function() end
T.spawn = function(opts) captured = opts; return 1 end
M.cmd_for = function() return { vim.fn.exepath('node') } end
P.resume_command = function(agent, mode, id)
  assert(agent == 'codex' and mode == 'continue' and id == nil)
  return { vim.fn.exepath('node'), '--last' }
end
M.pick = function(cb) cb({ agent='codex', cwd=vim.fn.getcwd(), model='gpt-6.1-sol', name='신규' }) end
M.open('new')
assert(captured.role == 'plan' and captured.model == 'gpt-6.1-sol' and captured.session_name == '계획 | 신규' and not captured.resume)
M.pick = function(cb) cb({ agent='codex', cwd=vim.fn.getcwd(), resume='continue' }) end
M.open('continue')
assert(captured.resume == 'continue' and captured.cmd[2] == '--last' and not captured.saved and not captured.model)
M.pick, T.spawn, W.open, M.cmd_for, P.resume_command = pick, spawn, open, command, resume
print('resume selection identity and activity passed')

vim.fn.delete(role_root, 'rf')
