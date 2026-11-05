-- Exact saved resume identity must also authorize task completion without a handoff.
local config = vim.fn.stdpath('config')
vim.opt.rtp:prepend(config)
local root = vim.fn.tempname() .. '-resume-complete'
local runtime = root .. '/runtime'
vim.fn.mkdir(runtime .. '/bin', 'p')
for _, file in ipairs(vim.fn.glob(config .. '/../scripts/runtime/*.mjs', false, true)) do
  vim.fn.writefile(vim.fn.readfile(file, 'b'), runtime .. '/bin/' .. vim.fn.fnamemodify(file, ':t'), 'b')
end
local P = require('config.agent.policy')
P.installation = function() return { runtime = runtime, mode = 'both', models = config .. '/../runtime/models.json' } end
local session_cli = runtime .. '/bin/session.mjs'
vim.env.AGENT_HUB_HOME = root .. '/hub'
vim.env.AGENT_HUB_INSTANCE, vim.env.AGENT_HUB_REQUEST, vim.env.AGENT_HUB_MANAGED = nil, nil, nil
require('config.agent').setup()
local H, T, R, A = require('config.agent.hub'), require('config.agent.terminal'), require('config.agent.reviews'), require('config.agent.activity')
local id = assert(T.spawn({ agent = 'Codex', resume = 'resume', name = '재개 | 미확인', cwd = vim.fn.getcwd(),
  cmd = { vim.fn.exepath('node'), '-e', 'setInterval(()=>{},1000)' } }))
local entry = T.registry[id]
assert(entry.resume and not entry.role and not entry.model)
local document = root .. '/docs/user-review/resume.md'
vim.fn.mkdir(vim.fn.fnamemodify(document, ':h'), 'p')
vim.fn.writefile({ '# Resume review' }, document)
local request = { owner = id, parent_id = id, task_id = entry.task_id, verified = true, reviewed = true }
local send, select = T.send, vim.ui.select
T.send = function() return true end
local function approved()
  entry.role, entry.model, entry.confirmed_role, entry.confirmed_model = nil, nil, nil, nil
  assert(R.register({ path = document, owner = id, task_id = entry.task_id }):match('^OK'))
  assert(R.decide(R.items()[1].id, 'approved'):match('^OK'))
end
local session = '12345678-1234-1234-1234-123456789abc'
local home, confirmation = root .. '/codex', root .. '/complete.json'
vim.fn.mkdir(home .. '/sessions', 'p')
vim.fn.writefile({ vim.json.encode({ type = 'session_meta', payload = { id = session } }),
  vim.json.encode({ type = 'turn_context', payload = { model = 'gpt-6.1-sol' } }) }, home .. '/sessions/rollout-' .. session .. '.jsonl')
local function cli(role, override_id)
  H.write(home .. '/session_index.jsonl', { id = session, thread_name = role .. ' | Resume' })
  local forged = vim.tbl_extend('force', request, { resolved_session = { role = 'plan', model = 'gpt-6.1-sol' } })
  assert(H.write(confirmation, forged))
  local result
  vim.system({ vim.fn.exepath('node'), session_cli, 'task-complete', confirmation }, {
    text = true, env = { NVIM = vim.v.servername, AGENT_SESSION_ID = tostring(id), AGENT_SESSION_VENDOR = 'codex',
      AGENT_SESSION_ROLE = 'plan', AI_SETTINGS_HOME = runtime, CODEX_HOME = home, CODEX_THREAD_ID = override_id or session, CODEX_SESSION_ID = override_id or session },
  }, function(value) result = value end)
  assert(vim.wait(8000, function() return result ~= nil end, 10), 'CLI completion timeout')
  return result
end
local ok, failure = xpcall(function()
  local confirmations = 0
  vim.ui.select = function(_, _, cb) confirmations = confirmations + 1; cb(nil) end
  approved()
  local stop = { owner = id, instance = H.id, token = entry.event_token, at = os.time() * 1000 + 1,
    status = 'idle', event = 'Stop', source = 'codex:Stop' }
  assert(A.receive(stop):match('^OK') and #R.items() == 1, 'raw Stop retains approved review')
  local start = vim.tbl_extend('force', stop, { at = stop.at + 1, cli_session = session, event = 'SessionStart',
    saved = { id = session, title = '계획 | Resume', role = 'plan', model = 'gpt-6.1-sol' } })
  assert(A.receive(start):match('^OK') and entry.name == '계획 | Resume' and entry.role == 'plan')
  assert(vim.b[entry.buf].agent_name == entry.name)
  stop.at = start.at
  local result = cli('계획')
  assert(result.code == 0 and result.stdout:match('^OK'), (result.stdout or '') .. (result.stderr or ''))
  assert(entry.role == 'plan' and entry.model == 'gpt-6.1-sol' and confirmations == 0, 'CLI passes exact saved model and plan role')
  assert(#R.items() == 0 and vim.fn.filereadable(document) == 1)
  stop.at = stop.at + 1
  assert(A.receive(stop):match('^OK') and entry.status == 'complete' and #R.items() == 0, 'late Stop preserves explicit completion')
  approved()
  result = cli('renamed')
  assert(result.code == 0 and entry.role == 'plan', 'renaming the same ID preserves the confirmed role')
  for index, role in ipairs({ '작업', '리뷰' }) do
    approved()
    session = index == 1 and 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' or 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    entry.cli_session = session
    vim.fn.writefile({ vim.json.encode({ type = 'session_meta', payload = { id = session } }),
      vim.json.encode({ type = 'turn_context', payload = { model = 'gpt-6.1-sol' } }) }, home .. '/sessions/rollout-' .. session .. '.jsonl')
    result = cli(role)
    assert(result.code ~= 0 and result.stdout:match('^FAIL'), 'saved work/review cannot use plan completion rights')
    assert(#R.items() == 1 and R.items()[1].status == 'approved')
  end
  approved()
  session = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  entry.cli_session = session
  vim.fn.writefile({ vim.json.encode({ type = 'session_meta', payload = { id = session } }),
    vim.json.encode({ type = 'turn_context', payload = { model = 'gpt-6.1-sol' } }) }, home .. '/sessions/rollout-' .. session .. '.jsonl')
  result = cli('unknown')
  assert(result.code ~= 0 and result.stdout:match('^PENDING') and #R.items() == 1, 'unknown role requires confirmation')
  assert(not entry.role and not entry.confirmed_role)
  result = cli('unknown', 'dddddddd-dddd-dddd-dddd-dddddddddddd')
  assert(result.code ~= 0 and #R.items() == 1, 'different identity cannot authorize completion')
  vim.wait(30, function() return false end)
  entry.role, entry.model = nil, nil
  vim.ui.select = function(items, _, cb)
    for _, choice in ipairs(items) do
      if choice.id == 'plan' or choice.id == 'gpt-6.1-sol' then cb(choice); return end
    end
    error('expected explicit role/model choice')
  end
  assert(R.complete(request):match('^PENDING'))
  assert(vim.wait(3000, function() return entry.confirmed_role == 'plan' end))
  assert(R.complete(request):match('^PENDING'))
  assert(vim.wait(3000, function() return entry.confirmed_model == 'gpt-6.1-sol' end))
  assert(R.complete(request):match('^OK') and #R.items() == 0, 'manual confirmation persists after both choices')
  print('PASS resume completion: exact CLI metadata, self review, work/review denial, unknown/vendor/identity pending, explicit confirmation, Stop retention')
end, debug.traceback)
T.send, vim.ui.select = send, select
pcall(vim.fn.jobstop, entry.chan)
vim.fn.delete(root, 'rf')
if not ok then error(failure) end
