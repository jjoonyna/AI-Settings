local config = vim.fn.stdpath('config')
vim.opt.rtp:prepend(config)
local runtime = require('config.agent.policy').installation().runtime
local session_cli = runtime .. '/bin/session.mjs'
if vim.fn.filereadable(session_cli) ~= 1 then session_cli = config .. '/../scripts/runtime/session.mjs' end
vim.o.hidden, vim.o.columns, vim.o.lines = true, 190, 48
vim.env.AGENT_HUB_HOME = vim.fn.tempname() .. '-workspace'
vim.env.AGENT_HUB_INSTANCE, vim.env.AGENT_HUB_REQUEST, vim.env.AGENT_HUB_MANAGED = nil, nil, nil
local H = require('config.agent.hub')
H.setup()
require('config.agent').setup()
local W, T, R, A = require('config.agent.workspace'), require('config.agent.terminal'), require('config.agent.reviews'), require('config.agent.activity')
local original_tab = vim.api.nvim_get_current_tabpage()
local original_buf = vim.api.nvim_get_current_buf()
local root = vim.fn.tempname()
vim.fn.mkdir(root .. '/docs/user-review', 'p')
local p, q = root .. '/docs/user-review/first.md', root .. '/docs/user-review/second.md'
vim.fn.writefile({ '# First', 'A long paragraph to verify the document can wrap within a narrow pane.' }, p)
vim.fn.writefile({ '# Second' }, q)
local ok, failure = xpcall(function()
  H.instances = function() error('workspace must not scan external sessions') end
  W.open(false)
  local s = W.state
  assert(vim.api.nvim_get_current_tabpage() ~= original_tab and vim.api.nvim_tabpage_get_win(original_tab), 'dedicated tab')
  assert(#vim.api.nvim_tabpage_list_wins(s.tab) == 2)
  local cmd = { vim.fn.exepath('node'), '-e', 'setInterval(()=>{},1000)' }
  local a = assert(T.spawn({ agent = 'Codex', role = 'plan', model = 'gpt-6.1-sol', cmd = cmd, cwd = root, name = '계획 | A' }))
  local b = assert(T.spawn({ agent = 'Codex', role = 'work', model = 'gpt-6.1-terra', cmd = cmd, cwd = root, name = '작업 | B', env = { AGENT_PARENT_ID = tostring(a) } }))
  W.refresh()
  assert(#s.rows == 2, 'both local sessions are listed')
  local entry = T.registry[a]
  local task = T.registry[b].task_id
  local ns = vim.api.nvim_get_namespaces().agent_workspace_status
  for status, group in pairs({ working = 'Working', idle = 'Waiting', response_requested = 'Waiting', review_pending = 'Waiting',
    interrupted = 'Stopped', error = 'Stopped', complete = 'Complete', unknown = 'Unknown', invalid = 'Unknown' }) do
    entry.status, entry.activity_status = status, status == 'review_pending' and 'working' or nil
    W.refresh()
    local index
    for i, item in ipairs(s.rows) do if item.entry.id == a and item.instance.instance == H.id then index = i end end
    local line = (index - 1) * 4 + 2
    local marks = vim.api.nvim_buf_get_extmarks(s.ai_buf, ns, { line, 0 }, { line, -1 }, { details = true })
    assert(#marks == (status == 'review_pending' and 2 or 1), 'status highlights replaced on refresh')
    assert(marks[1][4].hl_group == 'AgentStatus' .. group, 'status color: ' .. status)
    if status == 'review_pending' then assert(marks[2][4].hl_group == 'AgentStatusWorking', 'review activity color') end
  end
  entry.status, entry.activity_status = 'review_pending', 'working'
  W.refresh()
  vim.api.nvim_set_current_win(s.ai)
  for i, item in ipairs(s.rows) do if item.entry.id == a then vim.api.nvim_win_set_cursor(s.ai, { (i - 1) * 4 + 1, 0 }) end end
  local notify, message = vim.notify
  vim.notify = function(value) message = value end
  vim.fn.maparg('?', 'n', false, true).callback()
  vim.notify = notify
  assert(message:find('검토 대기', 1, true) and message:find('작업 중', 1, true), 'help identifies status and activity')
  vim.api.nvim_set_hl(0, 'AgentStatusWorking', {})
  vim.api.nvim_exec_autocmds('ColorScheme', {})
  assert(vim.api.nvim_get_hl(0, { name = 'AgentStatusWorking' }).fg, 'colors restored after ColorScheme')
  entry.status, entry.activity_status = 'unknown', nil
  local function cli(action, argument, owner)
    local e = T.registry[owner]
    local result
    vim.system({ vim.fn.exepath('node'), session_cli, action, argument }, {
      text = true, env = { NVIM = vim.v.servername, AGENT_SESSION_ID = tostring(owner), AGENT_TASK_ID = e.task_id,
        AGENT_EVENT_INSTANCE = H.id, AGENT_EVENT_TOKEN = e.event_token },
    }, function(value) result = value end)
    assert(vim.wait(8000, function() return result ~= nil end, 10), 'CLI RPC timeout')
    assert(result.code == 0, (result.stdout or '') .. (result.stderr or ''))
    return result.stdout
  end
  assert(W.select(a, true)); assert(W.select(b, true)); assert(W.select(a, true))
  assert(vim.fn.jobwait({ entry.chan, T.registry[b].chan }, 0)[1] == -1 and vim.fn.jobwait({ T.registry[b].chan }, 0)[1] == -1)
  local focus = vim.api.nvim_get_current_win()
  local preview = require('config.agent.plan_preview')
  assert(preview.show({ path = p, owner = b, task_id = task }):match('^OK'))
  assert(cli('preview', p, b):match('^OK'), 'CLI preview passes exact environment owner/task')
  assert(vim.api.nvim_get_current_win() == focus, 'preview preserves focus')
  assert(#vim.api.nvim_tabpage_list_wins(s.tab) == 4)
  local positions = {}
  for _, key in ipairs({ 'ai', 'chat', 'body', 'docs' }) do positions[#positions + 1] = vim.api.nvim_win_get_position(s[key])[2] end
  assert(positions[1] < positions[2] and positions[2] < positions[3] and positions[3] < positions[4], 'pane order')
  assert(vim.bo[s.body_buf].readonly and not vim.bo[s.body_buf].modifiable and vim.wo[s.body].wrap)
  assert(preview.show(p):match('^FAIL'), 'ambiguous legacy owner fails')
  assert(preview.show({ path = q, owner = a, task_id = entry.task_id }):match('^OK'))
  local items = R.items()
  local first, second = items[1], items[2]
  assert(W.select_review(first.id))
  vim.api.nvim_set_current_win(s.body)
  vim.api.nvim_win_set_cursor(s.docs, { 4, 0 })
  local send, sent = T.send
  T.send = function(id, text) sent = { id, text }; return true end
  W.decision('approved')
  assert(sent[1] == b and sent[2]:find(p, 1, true), 'body decision uses displayed document')
  assert(#R.items() == 2, 'approval retains document')
  local complete = { owner = b, task_id = task, parent_id = a, verified = true, reviewed = true }
  vim.fn.writefile({ '# Revised' }, p)
  W.refresh()
  assert(R.items()[1].status == 'review_pending', 'fingerprint invalidates approval')
  assert(R.complete(complete):match('^FAIL'), 'pending revision blocks completion')
  assert(R.decide(first.id, 'changes_requested', 'revise'):match('^OK'))
  assert(R.complete(complete):match('^FAIL'), 'changes requested blocks completion')
  assert(R.decide(first.id, 'approved'):match('^OK'))
  assert(R.complete({ owner = b, task_id = task, parent_id = b, verified = true, reviewed = true }):match('^FAIL'))
  assert(R.complete(complete):match('^OK'))
  assert(#R.items() == 1 and R.items()[1].owner == a and vim.fn.filereadable(p) == 1)
  local event = { owner = b, instance = H.id, token = T.registry[b].event_token, at = os.time() * 1000 + 1, status = 'idle', cli_session = 'main' }
  assert(A.receive(event):match('^OK') and T.registry[b].status == 'complete', 'Stop does not overwrite completion')
  assert(A.receive(event):match('^FAIL'), 'stale event rejected')
  event.at, event.token = event.at + 1, 'another-process'
  assert(A.receive(event):match('^FAIL'))
  event.at, event.cli_session, event.status, event.event, event.turn_id = event.at + 1, 'main', 'working', 'UserPromptSubmit', 'new-turn'
  event.token = T.registry[b].event_token
  assert(A.receive(event):match('^OK') and T.registry[b].status == 'working', 'new prompt starts work after completion')
  event.at, event.status, event.event, event.turn_id = event.at + 1, 'idle', 'Stop', 'old-turn'
  assert(A.receive(event):match('^FAIL') and T.registry[b].status == 'working', 'old turn cannot overwrite new prompt')
  event.at, event.turn_id = event.at + 1, 'new-turn'
  assert(A.receive(event):match('^OK') and T.registry[b].status == 'idle')
  event.at, event.token, event.cli_session = event.at + 1, T.registry[b].event_token, 'subagent'
  assert(A.receive(event):match('^FAIL'))
  vim.api.nvim_set_current_win(s.body)
  local hide = vim.fn.maparg('<C-d>', 'n', false, true).callback
  hide(); W.refresh(); assert(not s.body, 'user hide survives refresh')
  W.show('body'); assert(s.body)
  for _, cols in ipairs({ 110, 70, 40, 190 }) do vim.o.columns = cols; W.refresh() end
  assert(#vim.api.nvim_tabpage_list_wins(s.tab) == 4, 'resize restores panes')
  assert(vim.api.nvim_win_get_position(s.body)[2] < vim.api.nvim_win_get_position(s.docs)[2], 'restore keeps body before document list')
  assert(R.decide(second.id, 'approved'):match('^OK'))
  assert(cli('activity', 'working', a):match('^OK'), 'explicit status API')
  local confirmation = root .. '/complete.json'
  assert(H.write(confirmation, { owner = a, task_id = entry.task_id, verified = true, reviewed = true }))
  assert(cli('task-complete', confirmation, a):match('^OK'), 'CLI completion passes parent identity')
  assert(#vim.api.nvim_tabpage_list_wins(s.tab) == 2 and vim.fn.filereadable(q) == 1)
  T.send = send
  for _, case in ipairs({ { 0, 'interrupted' }, { 3, 'error' }, { 0, 'complete' }, { 0, 'review_pending' } }) do
    local id = assert(T.spawn({ agent = 'Codex', role = 'work', cwd = root, name = '종료 검증',
      cmd = { vim.fn.exepath('node'), '-e', 'process.exit(' .. case[1] .. ')' } }))
    if case[2] == 'complete' or case[2] == 'review_pending' then T.registry[id].status = case[2] end
    assert(vim.wait(5000, function() return T.registry[id].exit_code ~= nil end, 20))
    assert(T.registry[id].status == case[2] and T.registry[id].exit_code == case[1], 'process exit is distinct from live idle')
    assert(not T.send(id, 'cannot receive input'))
  end
  local store = H.root() .. '/reviews/' .. H.id .. '.json'
  vim.fn.writefile({ 'corrupt' }, store)
  assert(not pcall(R.items), 'corruption is visible; never discarded')
  assert(H.write(store, { version = 1, items = {} }))
  assert(vim.api.nvim_buf_is_valid(original_buf), 'editor buffer retained')
  print('PASS workspace: layout, hidden jobs, exact review ownership, revision, completion, stale events, resize, corruption')
end, debug.traceback)
for _, e in ipairs(T.entries()) do pcall(vim.fn.jobstop, e.chan) end
if not ok then error(failure) end
