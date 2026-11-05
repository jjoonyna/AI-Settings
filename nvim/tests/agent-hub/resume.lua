vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local P = require('config.agent.policy')
local original = P.installation
P.installation = function() return { mode = 'both', runtime = '.' } end
local session_id = '12345678-1234-1234-1234-123456789abc'
assert(vim.deep_equal(P.resume_command('codex', 'resume', session_id), { 'codex', 'resume', session_id }))
assert(vim.deep_equal(P.resume_command('codex', 'continue'), { 'codex', 'resume', '--last' }))
assert(vim.deep_equal(P.resume_command('claude', 'resume', session_id), { 'claude', '--resume', session_id }))
assert(not P.resume_command('codex', 'resume', 'invalid'))
assert(vim.deep_equal(P.resume_command('claude', 'continue'), { 'claude', '--continue' }))
assert(not P.resume_command('codex', 'invalid'))
local menu = require('config.agent.menu')
local select0, input0 = vim.ui.select, vim.ui.input
local calls, selected = 0
local system0 = vim.system
vim.system = function(_, _, cb) cb({ code = 0, stdout = vim.json.encode({ { id = session_id, title = '계획 | 테스트' } }) }) end
vim.ui.input = function() error('resume must not ask for input') end
vim.ui.select = function(items, opts, cb) calls = calls + 1; cb(items[1]) end
menu.pick(function(o) selected = o end, 'resume')
assert(vim.wait(1000, function() return selected ~= nil end))
assert(calls == 2 and selected.resume == 'resume' and selected.saved.id == session_id and not selected.model and not selected.name)
vim.ui.select = function(items, opts, cb) if opts.prompt == '이어서 할 세션' then cb(nil) else cb(items[1]) end end
selected = nil; menu.pick(function(o) selected = o end, 'resume')
vim.wait(100, function() return false end)
assert(not selected, 'cancelling selection must not launch a session')
P.installation = function() return { mode = 'codex', runtime = '.' } end
assert(not P.resume_command('claude', 'resume'))
menu.pick(function(o) selected = o end, 'continue')
assert(selected.agent == 'codex' and selected.resume == 'continue')
vim.ui.select = function(items, opts, cb) cb(nil) end
selected = nil; menu.pick(function(o) selected = o end)
assert(not selected)
vim.ui.select, vim.ui.input, vim.system, P.installation = select0, input0, system0, original
print('resume policy and menu passed')
local hub = require('config.agent.hub')
local launcher = require('config.agent.launcher')
local terminal = require('config.agent.terminal')
local read0, write0, publish0, spawn0, command0 = hub.read, hub.write, hub.publish, terminal.spawn, P.resume_command
local request = { instance = hub.id, agent = 'codex', session = 'plan', resume = 'continue', cwd = vim.fn.getcwd(), task_id = 'test' }
local captured, response
hub.read = function() return request end
hub.write = function(_, data) response = data end
hub.publish = function() end
P.resume_command = function() return { vim.fn.exepath('node'), '--version' } end
terminal.spawn = function(opts) captured = opts; return 1 end
launcher.consumed = nil
launcher.consume('test')
assert(response.ok and captured.cwd == request.cwd)
assert(not captured.model and not captured.env.AGENT_SESSION_MODEL and not captured.session_name and not captured.briefing)
assert(captured.name == '재개 | 저장된 이름 확인 불가')
request.resume = 'invalid'; P.resume_command = function() return nil end
launcher.consumed = nil; captured = nil
launcher.consume('test')
assert(not response.ok and not captured)
hub.read, hub.write, hub.publish, terminal.spawn, P.resume_command = read0, write0, publish0, spawn0, command0
print('resume launcher passed')
local role_root = vim.fn.tempname()
vim.fn.mkdir(role_root .. '/bin', 'p')
vim.fn.writefile(vim.fn.readfile('scripts/runtime/session-role.mjs', 'b'), role_root .. '/bin/session-role.mjs', 'b')
P.installation = function() return { mode = 'both', runtime = role_root } end
local handoff = require('config.agent.handoff')
local catalog0, cmd0, select1 = P.catalog, P.command, vim.ui.select
P.catalog = function() return { defaults = { codex = 'gpt-6.1-sol' }, models = {
  { id = 'gpt-6.1-sol', vendor = 'codex', tier = 3, label = 'Sol' },
  { id = 'gpt-6-luna', vendor = 'codex', tier = 1, label = 'Luna' } } } end
P.command = function() return { vim.fn.exepath('node') } end
terminal.spawn = function(opts) captured = opts; return 10 end
if vim.v.servername == '' then vim.fn.serverstart() end
local doc = vim.fn.tempname(); vim.fn.writefile({ 'spec' }, doc)
terminal.registry[999] = { id = 999, agent = 'Codex', resume = 'resume' }
vim.system({ 'node', role_root .. '/bin/session-role.mjs', 'save', 'codex', session_id, 'plan' }, { env = { AI_SETTINGS_HOME = role_root } }):wait()
local req = { parent_id = 999, parent_server = vim.v.servername, agent = 'codex', session = 'work', model = 'gpt-6-luna',
  name = 'x', goal = 'x', scope = 'x', validation = 'x', prompt = 'x', spec_doc = doc, plan_doc = doc, cwd = vim.fn.getcwd(), resolved_session = { id = '12345678-1234-1234-1234-123456789abc', model = 'gpt-6.1-sol', role = 'plan' } }
assert(handoff.receive(req):find('OK', 1, true))
req.model = 'gpt-6.1-sol'; req.resolved_session = { id = '12345678-1234-1234-1234-123456789abc', model = 'gpt-6-luna', role = 'plan' }
assert(handoff.receive(req):find('FAIL:', 1, true))
req.resolved_session = { id = '12345678-1234-1234-1234-123456789abc', model = 'unknown', role = 'plan' }; req.model = 'gpt-6-luna'
terminal.registry[999].model = nil
vim.ui.select = function(items, _, cb) cb(items[1]) end
assert(handoff.receive(req):find('PENDING:', 1, true))
assert(vim.wait(1000, function() return terminal.registry[999].confirmed_model ~= nil end))
assert(handoff.receive(req):find('OK', 1, true))
local other = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
vim.system({ 'node', role_root .. '/bin/session-role.mjs', 'save', 'codex', other, 'review' }, { env = { AI_SETTINGS_HOME = role_root } }):wait()
terminal.registry[999].cli_session = other
req.resolved_session = { id = other, model = 'gpt-6.1-sol', role = 'review' }
assert(handoff.receive(req):find('FAIL:', 1, true))
terminal.registry[999].cli_session = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
req.resolved_session = { id = terminal.registry[999].cli_session, model = 'gpt-6.1-sol' }
assert(handoff.receive(req):find('PENDING:', 1, true))
assert(vim.wait(1000, function() return terminal.registry[999].confirmed_role ~= nil end))
assert(handoff.receive(req):find('OK', 1, true))
terminal.registry[999] = nil; terminal.spawn = spawn0; P.catalog, P.command, vim.ui.select = catalog0, cmd0, select1
vim.fn.delete(doc)
print('resume handoff passed')

P.installation = original
vim.fn.delete(role_root, 'rf')
