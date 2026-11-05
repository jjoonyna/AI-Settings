vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local policy = require('config.agent.policy')
local root = vim.fn.tempname()
vim.fn.mkdir(root .. '/bin', 'p')
vim.fn.writefile(vim.fn.readfile('scripts/runtime/session-role.mjs', 'b'), root .. '/bin/session-role.mjs', 'b')
local old = policy.installation
policy.installation = function() return { runtime = root } end
local handoff = require('config.agent.handoff')
local id = '12345678-1234-1234-1234-123456789abc'
local parent = { agent = 'Codex', resume = 'resume', cli_session = id, model = 'known' }
local select0 = vim.ui.select
vim.ui.select = function(items, _, cb) cb(items[2]) end
assert(handoff.resolve_resume(parent, { id = id }):find('PENDING:', 1, true))
assert(vim.wait(3000, function() return parent.confirmed_role ~= nil end))
assert(parent.confirmed_role == 'work')
local reopened = { agent = 'Codex', resume = 'resume', cli_session = id, model = 'known' }
assert(handoff.resolve_resume(reopened, { id = id }) == nil)
assert(reopened.role == 'work')
local unknown = { agent = 'Codex', resume = 'resume', model = 'known' }
assert(handoff.resolve_resume(unknown, nil):find('FAIL:', 1, true))
local cancel_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
local cancelled = { agent = 'Codex', resume = 'resume', cli_session = cancel_id, model = 'known' }
vim.ui.select = function(_, _, cb) cb(nil) end
assert(handoff.resolve_resume(cancelled, { id = cancel_id }):find('PENDING:', 1, true))
vim.wait(100, function() return false end)
assert(not cancelled.role and not cancelled.confirmed_role)
assert(vim.fn.filereadable(root .. '/state/session-roles/codex/' .. cancel_id .. '.json') == 0)
local corrupt_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
vim.fn.writefile({ '{' }, root .. '/state/session-roles/codex/' .. corrupt_id .. '.json')
local corrupt = { agent = 'Codex', resume = 'resume', cli_session = corrupt_id, model = 'known' }
assert(handoff.resolve_resume(corrupt, { id = corrupt_id }):find('FAIL:', 1, true))
assert(not handoff.verified_role(corrupt))
local terminal = require('config.agent.terminal')
local reviews = require('config.agent.reviews')
local owner = { id = 9002, parent_id = 9001, task_id = 'role-test' }
terminal.registry[9002] = owner
for _, role in ipairs({ 'work', 'review' }) do
  local role_id = role == 'work' and id or 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  if role == 'review' then
    assert(vim.system({ 'node', root .. '/bin/session-role.mjs', 'save', 'codex', role_id, role }, { env = { AI_SETTINGS_HOME = root } }):wait().code == 0)
  end
  terminal.registry[9001] = { id = 9001, agent = 'Codex', role = role, cli_session = role_id }
  local result = reviews.complete({ owner = 9002, parent_id = 9001, task_id = 'role-test', verified = true, reviewed = true })
  assert(result:find('FAIL:', 1, true))
end
terminal.registry[9001], terminal.registry[9002] = nil, nil
vim.ui.select = select0
policy.installation = old
vim.fn.delete(root, 'rf')
print('role resume passed')
