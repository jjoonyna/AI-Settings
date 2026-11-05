vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local P = require('config.agent.policy')
local root = vim.fn.tempname()
vim.fn.mkdir(root .. '/bin', 'p')
vim.fn.writefile(vim.fn.readfile('scripts/runtime/session-role.mjs', 'b'), root .. '/bin/session-role.mjs', 'b')
P.installation = function() return { runtime = root } end
local T, H, A = require('config.agent.terminal'), require('config.agent.hub'), require('config.agent.activity')
H.publish = function() end
require('config.agent.workspace').refresh = function() end
local id = '12345678-1234-1234-1234-123456789abc'
local other = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
local now = os.time() * 1000
local e = { id = 1, agent = 'Codex', role = 'work', event_token = 'token', event_started = now - 100, event_at = now - 10, cli_session = id, active_turn = 'turn' }
T.registry[1] = e
local event = { owner = 1, instance = H.id, token = 'token', at = now, cli_session = id, event = 'SessionStart', status = 'idle', turn_id = 'turn' }
local function missing(which) return vim.fn.filereadable(root .. '/state/session-roles/codex/' .. which .. '.json') == 0 end
for _, change in ipairs({ { cli_session = other }, { token = 'wrong' }, { instance = 'wrong' }, { at = now - 200 }, { turn_id = 'old' } }) do
  local bad = vim.tbl_extend('force', event, change)
  assert(A.receive(bad):match('^FAIL'))
  assert(missing(id) and missing(other), 'rejected event must not save role')
end
assert(A.receive(event):match('^OK'))
assert(not missing(id), 'accepted managed SessionStart must save role')
local delayed_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
local delayed = { id = 3, agent = 'Codex', role = 'work', event_token = 'token', event_started = now - 100, event_at = now, cli_session = delayed_id, active_turn = 'turn', status = 'working', activity_status = 'working' }
T.registry[3] = delayed
local late = { owner = 3, instance = H.id, token = 'token', at = now - 1, cli_session = delayed_id, event = 'SessionStart', status = 'idle', turn_id = 'turn' }
for _, change in ipairs({ { cli_session = other }, { token = 'wrong' }, { instance = 'wrong' }, { at = now - 200 }, { turn_id = 'old' } }) do
  assert(A.receive(vim.tbl_extend('force', late, change)):match('^FAIL'))
  assert(missing(delayed_id) and missing(other), 'rejected delayed event cannot save')
end
local bound = delayed.cli_session
delayed.cli_session = nil
assert(A.receive(late):match('^FAIL') and missing(delayed_id), 'delayed start requires prior exact identity')
delayed.cli_session = bound
assert(A.receive(late):match('^OK') and not missing(delayed_id), 'late managed start saves assigned role')
assert(delayed.status == 'working' and delayed.activity_status == 'working' and delayed.event_at == now and delayed.active_turn == 'turn')
assert(A.receive(late):match('^FAIL'))
T.registry[3] = nil
local handoff = require('config.agent.handoff')
e.role = 'plan'
assert(not handoff.verified_role(e), 'conflicting role must not authorize')
e.role = 'work'
local legacy = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
local resumed = { id = 2, agent = 'Codex', resume = 'resume', event_token = 'token', event_started = now - 100, event_at = now - 10, cli_session = legacy, active_turn = 'turn' }
T.registry[2] = resumed
local resume_event = { owner = 2, instance = H.id, token = 'token', at = now - 20, cli_session = legacy, event = 'SessionStart', status = 'idle', turn_id = 'turn', saved = { id = legacy, role = 'plan', title = 'legacy' } }
assert(A.receive(resume_event):match('^OK') and not missing(legacy), 'validated late start saves role')
assert(resumed.role == 'plan' and resumed.event_at == now - 10 and resumed.active_turn == 'turn')
assert(A.receive(resume_event):match('^FAIL'), 'duplicate start cannot replay')
T.registry[2] = nil
local broken = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
vim.fn.writefile({ '{' }, root .. '/state/session-roles/codex/' .. broken .. '.json')
e.cli_session, e.role, e.event_at = broken, 'plan', now - 1
event.cli_session, event.at = broken, now + 1
assert(A.receive(event):match('^OK'))
assert(not handoff.verified_role(e), 'corrupt record cannot authorize')
local badroot = root .. '/unwritable'
vim.fn.mkdir(badroot .. '/bin', 'p')
vim.fn.writefile(vim.fn.readfile(root .. '/bin/session-role.mjs', 'b'), badroot .. '/bin/session-role.mjs', 'b')
vim.fn.writefile({ 'block directory' }, badroot .. '/state')
P.installation = function() return { runtime = badroot } end
e.cli_session, e.role, e.event_at = id, 'plan', now + 1
event.cli_session, event.at = id, now + 2
assert(A.receive(event):match('^OK'))
assert(not handoff.verified_role(e), 'save failure cannot authorize')
T.registry[1] = nil
vim.fn.delete(root, 'rf')
print('activity role acceptance passed')
