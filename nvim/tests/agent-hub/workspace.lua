local config = vim.fn.stdpath('config')
vim.opt.rtp:prepend(config)
local role_root = vim.fn.tempname() .. '-roles'
vim.fn.mkdir(role_root .. '/bin', 'p')
for _, file in ipairs(vim.fn.glob(config .. '/../scripts/runtime/*.mjs', false, true)) do
  vim.fn.writefile(vim.fn.readfile(file, 'b'), role_root .. '/bin/' .. vim.fn.fnamemodify(file, ':t'), 'b')
end
local P = require('config.agent.policy')
P.installation = function() return { runtime = role_root, mode = 'both', models = config .. '/../runtime/models.json' } end
local session_cli = role_root .. '/bin/session.mjs'
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
local p, q = root .. '/docs/user-review/first.md', root .. '/docs/user-review/second-document-with-a-long-title-for-wrapping.md'
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
  local c = assert(T.spawn({ agent = 'Codex', role = 'plan', cwd = root, name = '계획 | C', cmd = cmd }))
  local d = assert(T.spawn({ agent = 'Codex', role = 'review', cwd = root, name = '리뷰 | D', cmd = cmd, env = { AGENT_PARENT_ID = tostring(a) } }))
  local e = assert(T.spawn({ agent = 'Codex', role = 'work', cwd = root, name = '작업 | E', cmd = cmd, env = { AGENT_PARENT_ID = tostring(c) } }))
  local orphan = assert(T.spawn({ agent = 'Codex', role = 'work', cwd = root, name = '고아', cmd = cmd, env = { AGENT_PARENT_ID = '999999' } }))
  W.refresh()
  assert(W.select(a, false)); W.refresh()
  assert(#s.rows == 5, 'selected plan and children listed')
  for i, id in ipairs({ a, b, d, c, orphan }) do assert(s.rows[i].entry.id == id, 'group order') end
  local rendered = vim.api.nvim_buf_get_lines(s.ai_buf, 0, -1, false)
  assert(rendered[1]:find('● 계획|A', 1, true) and rendered[3]:find('    ● 작업|B', 1, true), vim.inspect(rendered))
  assert(W.select(orphan, false), 'orphan remains selectable')
  assert(W.select(a, false))
  local entry = T.registry[a]
  entry.cli_session = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  assert(vim.system({ 'node', role_root .. '/bin/session-role.mjs', 'save', 'codex', entry.cli_session, 'plan' }, { env = { AI_SETTINGS_HOME = role_root } }):wait().code == 0)
  local task = T.registry[b].task_id
  local ns = vim.api.nvim_get_namespaces().agent_workspace_status
  for status, group in pairs({ working = 'Working', idle = 'Waiting', response_requested = 'Waiting', review_pending = 'Working',
    interrupted = 'Stopped', error = 'Stopped', complete = 'Complete', unknown = 'Unknown', invalid = 'Unknown' }) do
    entry.status, entry.activity_status = status, status == 'review_pending' and 'working' or nil
    W.refresh()
    local index
    for i, item in ipairs(s.rows) do if item.entry.id == a and item.instance.instance == H.id then index = i end end
    local line = s.rows[index].first - 1
    local marks = vim.api.nvim_buf_get_extmarks(s.ai_buf, ns, { line, 0 }, { line, -1 }, { details = true })
    assert(#marks == 1 and marks[1][3] == #'▼ ', 'one dot before name')
    assert(marks[1][4].hl_group == 'AgentStatus' .. group, 'status color: ' .. status)
  end
  entry.status, entry.activity_status = 'review_pending', nil
  W.refresh()
  local unknown = vim.api.nvim_buf_get_extmarks(s.ai_buf, ns, { 0, 0 }, { 0, -1 }, { details = true })
  assert(#unknown == 1 and unknown[1][4].hl_group == 'AgentStatusUnknown', 'missing activity is unknown')
  entry.activity_status = 'working'
  W.refresh()
  vim.api.nvim_set_current_win(s.ai)
  for i, item in ipairs(s.rows) do if item.entry.id == a then vim.api.nvim_win_set_cursor(s.ai, { item.first, 0 }) end end
  local notify, message = vim.notify
  vim.notify = function(value) message = value end
  vim.fn.maparg('?', 'n', false, true).callback()
  vim.notify = notify
  assert(message:find('상태: 작업 중', 1, true) and not message:find('검토 대기', 1, true), 'help matches activity dot')
  entry.activity_status = nil; W.refresh()
  vim.notify = function(value) message = value end
  vim.fn.maparg('?', 'n', false, true).callback()
  vim.notify = notify
  assert(message:find('상태: 확인 불가', 1, true), 'help matches unknown activity dot')
  vim.api.nvim_set_hl(0, 'AgentStatusWorking', {})
  vim.api.nvim_exec_autocmds('ColorScheme', {})
  assert(vim.api.nvim_get_hl(0, { name = 'AgentStatusWorking' }).fg, 'colors restored after ColorScheme')
  entry.status, entry.activity_status = 'unknown', nil
  local function cli(action, argument, owner)
    local e = T.registry[owner]
    local result
    vim.system({ vim.fn.exepath('node'), session_cli, action, argument }, {
      text = true, env = { NVIM = vim.v.servername, AGENT_SESSION_ID = tostring(owner), AGENT_TASK_ID = e.task_id,
        AGENT_EVENT_INSTANCE = H.id, AGENT_EVENT_TOKEN = e.event_token, AI_SETTINGS_HOME = role_root },
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
  do -- wide tables become grids in the body; narrow tables and the file stay as written
    local saved, previous = s.document, vim.fn.readfile(p)
    for _, item in ipairs(R.items()) do if item.path == p then s.document = item.id end end
    local narrow = '| a | b |'
    vim.fn.writefile({ narrow, '|---|---|', '| 1 | 2 |', '', '| head | body |', '|---|---|', '| x | ' .. ('긴 설명 '):rep(40) .. ' |' }, p)
    W.refresh()
    local shown = table.concat(vim.api.nvim_buf_get_lines(s.body_buf, 0, -1, false), ' ')
    assert(shown:find('┌', 1, true) and shown:find(narrow, 1, true), 'wide table grid, narrow table raw')
    assert(vim.fn.readfile(p)[5] == '| head | body |', 'source file unchanged')
    vim.fn.writefile(previous, p); s.document = saved; W.refresh()
  end
  W.refresh()
  assert(vim.api.nvim_buf_get_lines(s.docs_buf, 0, 1, false)[1] == '> first', 'selected document title has no status label')
  local items = R.items()
  local first, second = items[1], items[2]
  local list = vim.api.nvim_buf_get_lines(s.docs_buf, 0, -1, false)
  assert(list[2] == '' and list[3] == '  계획|A' and list[4] == ''
    and list[6] == '' and list[7] == '  계획|A' and list[8] == '', 'parent and own plan titles with spacing')
  local get_items = R.items
  for _, status in ipairs({ 'review_pending', 'approved', 'changes_requested', 'unknown' }) do
    R.items = function()
      local copy = vim.deepcopy(items)
      copy[1].status, copy[1].path = status, root .. '/계획 | 제목.md'
      return copy
    end
    W.refresh()
    assert(vim.api.nvim_buf_get_lines(s.docs_buf, 0, 1, false)[1] == '> 계획|제목', 'no status label: ' .. status)
  end
  R.items = function()
    local copy = vim.deepcopy(items)
    copy[1].owner, copy[1].task_id, copy[1].parent_id = d, T.registry[d].task_id, a
    return copy
  end
  W.refresh()
  assert(vim.api.nvim_buf_get_lines(s.docs_buf, 2, 3, false)[1] == '  계획|A', 'review parent title')
  R.items = function()
    local copy = vim.deepcopy(items)
    copy[1].parent_id = c
    return copy
  end
  W.refresh()
  assert(vim.api.nvim_buf_get_lines(s.docs_buf, 2, 3, false)[1] == '  계획 제목 확인 불가', 'unverified parent')
  for _, change in ipairs({
    function(item) item.owner = 999999 end,
    function(item) item.task_id = 'wrong-task' end,
    function(item) item.parent_id = nil end,
    function(item) item.owner, item.task_id, item.parent_id = orphan, T.registry[orphan].task_id, 999999 end,
    function(item) item.parent_id = b end,
  }) do
    R.items = function()
      local copy = vim.deepcopy(items)
      change(copy[1])
      return copy
    end
    W.refresh()
    assert(vim.api.nvim_buf_get_lines(s.docs_buf, 2, 3, false)[1] == '  계획 제목 확인 불가', 'missing or invalid identity')
  end
  local snapshot = H.snapshot
  for _, change in ipairs({
    function(plan) plan.selecting = true end,
    function(plan) plan.name = '' end,
  }) do
    R.items = get_items
    H.snapshot = function()
      local result = snapshot()
      for _, session in ipairs(result.entries) do if session.id == a then change(session) end end
      return result
    end
    W.refresh()
    assert(vim.api.nvim_buf_get_lines(s.docs_buf, 2, 3, false)[1] == '  계획 제목 확인 불가', 'unavailable plan title')
  end
  H.snapshot = snapshot
  R.items = get_items; W.refresh()
  vim.api.nvim_win_set_cursor(s.docs, { 5, 0 })
  R.items = function() return { items[2], items[1] } end
  W.refresh()
  assert(vim.api.nvim_win_get_cursor(s.docs)[1] == 1, 'cursor follows the same document after reorder')
  R.items = get_items; W.refresh()
  assert(vim.api.nvim_win_get_cursor(s.docs)[1] == 5, 'cursor follows the document when order is restored')
  assert(not vim.wo[s.docs].wrap and not vim.wo[s.docs].linebreak and not vim.wo[s.ai].wrap and vim.wo[s.body].wrap, 'only body wraps')
  assert(vim.api.nvim_win_text_height(s.docs, { start_row = 4, end_row = 4 }).all == 1 and list[5]:match('%.%.%.$'), 'long document title truncates')
  do
    local original = T.registry[a].name
    local long = '계획 | 긴한글제목 English | preserved ' .. ('가나다'):rep(12)
    T.registry[a].name = long
    W.refresh()
    local ai = vim.api.nvim_buf_get_lines(s.ai_buf, 0, 1, false)[1]
    local owner = vim.api.nvim_buf_get_lines(s.docs_buf, 2, 3, false)[1]
    assert(ai:match('%.%.%.$') and owner:match('%.%.%.$'), 'long titles truncate')
    assert(vim.fn.strdisplaywidth(ai) <= vim.fn.getwininfo(s.ai)[1].width - vim.fn.getwininfo(s.ai)[1].textoff, 'AI text width')
    assert(vim.fn.strdisplaywidth(owner) <= vim.fn.getwininfo(s.docs)[1].width - vim.fn.getwininfo(s.docs)[1].textoff, 'owner text width')
    assert(T.registry[a].name == long, 'stored title unchanged')
    vim.o.columns = 70; W.refresh()
    vim.o.columns = 190; W.refresh()
    assert(vim.api.nvim_buf_get_lines(s.ai_buf, 0, 1, false)[1] == ai
      and vim.api.nvim_buf_get_lines(s.docs_buf, 2, 3, false)[1] == owner, 'resize restores titles from source')
    T.registry[a].name = original
    W.refresh()
    assert(vim.api.nvim_buf_get_lines(s.docs_buf, 2, 3, false)[1] == '  계획|A', 'full title restored')
  end
  vim.api.nvim_set_current_win(s.docs)
  vim.api.nvim_win_set_cursor(s.docs, { 2, 0 })
  vim.fn.maparg('j', 'n', false, true).callback()
  assert(vim.api.nvim_win_get_cursor(s.docs)[1] == 5, 'keyboard skips document spacing')
  vim.fn.maparg('<CR>', 'n', false, true).callback()
  assert(s.document == second.id, 'Enter selects wrapped document')
  assert(W.select_review(first.id))
  vim.api.nvim_set_current_win(s.body)
  vim.api.nvim_win_set_cursor(s.docs, { 5, 0 })
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
  local resumed = T.registry[orphan]
  resumed.resume = 'resume'
  assert(W.select(orphan, false) and vim.wo[s.chat].winbar == '  세션 선택 중')
  W.refresh()
  local function resume_row()
    for i, item in ipairs(s.rows) do
      if item.entry.id == orphan then
        local line = item.first - 1
        return item.entry, vim.api.nvim_buf_get_lines(s.ai_buf, line, line + 2, false)
      end
    end
    error('resumed session row disappeared')
  end
  local pending, pending_lines = resume_row()
  assert(pending.selecting and pending.name == '세션 선택 중' and pending_lines[2] == '', 'picker has no model line')
  local row_count = #s.rows
  local prompt = { owner = orphan, instance = H.id, token = resumed.event_token, at = event.at + 2,
    status = 'working', event = 'UserPromptSubmit', cli_session = '12345678-1234-1234-1234-123456789abc', turn_id = 'current' }
  assert(A.receive(prompt):match('^OK'))
  assert(not resume_row().selecting, 'exact activity identity resolves the picker state')
  local start = vim.tbl_extend('force', prompt, { at = prompt.at - 1, status = 'idle', event = 'SessionStart',
    saved = { id = prompt.cli_session, title = '계획 | 재개', role = 'plan', model = 'gpt-6.1-sol' } })
  assert(A.receive(start):match('^OK'), 'late start restores the selected session')
  assert(resumed.name == '계획 | 재개' and resumed.role == 'plan' and resumed.model == 'gpt-6.1-sol')
  local restored, restored_lines = resume_row()
  assert(#s.rows == row_count and restored.name == resumed.name and restored_lines[2]:find(resumed.model, 1, true)
    and vim.wo[s.chat].winbar == '  ' .. resumed.name, 'saved metadata updates the same row and chat title')
  assert(resumed.event_at == prompt.at and resumed.activity_status == 'working' and resumed.active_turn == 'current')
  assert(A.receive(start):match('^FAIL'), 'duplicate start remains stale')
  start.at, start.saved = prompt.at + 1, { id = prompt.cli_session, model = 'gpt-6.1-terra' }
  assert(A.receive(start):match('^OK') and resumed.name == '계획 | 재개' and resumed.role == 'plan'
    and resumed.model == 'gpt-6.1-terra', 'model-only metadata preserves verified name and role')
  start.at, start.saved = start.at + 1, { id = prompt.cli_session, title = '사용자가 바꾼 이름' }
  assert(A.receive(start):match('^OK') and resumed.name == '사용자가 바꾼 이름' and resumed.role == 'plan'
    and resumed.model == 'gpt-6.1-terra', 'renamed title preserves verified role and model')
  local managed = vim.deepcopy(resumed)
  managed.id, managed.resume, managed.role = 987654, nil, 'work'
  managed.cli_session = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  managed.event_at, managed.session_start_at, managed.active_turn = prompt.at, nil, 'current'
  managed.status, managed.activity_status = 'working', 'working'
  T.registry[managed.id] = managed
  local late = { owner = managed.id, instance = H.id, token = managed.event_token, at = prompt.at - 1,
    status = 'idle', event = 'SessionStart', cli_session = managed.cli_session, turn_id = 'current' }
  assert(A.receive(late):match('^OK') and managed.event_at == prompt.at and managed.status == 'working' and managed.active_turn == 'current')
  assert(require('config.agent.handoff').verified_role(managed), 'late managed start saves its assigned role')
  assert(A.receive(late):match('^FAIL'), 'late managed start cannot be replayed')
  T.registry[managed.id] = nil
  W.refresh()
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
vim.fn.delete(role_root, 'rf')
if not ok then error(failure) end
