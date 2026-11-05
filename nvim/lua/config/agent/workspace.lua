-- A dedicated tab owns the layout. Hidden terminal buffers keep their jobs alive.
local M = { state = nil }
local api = vim.api
local hub = require('config.agent.hub')
local status_ns = api.nvim_create_namespace('agent_workspace_status')
local status_groups = { working = 'Working', idle = 'Waiting', response_requested = 'Waiting', review_pending = 'Waiting',
  interrupted = 'Stopped', error = 'Stopped', complete = 'Complete', unknown = 'Unknown' }
local function activity_status(e)
  return e.status == 'review_pending' and (e.activity_status or 'unknown') or e.status
end
local function status_highlights()
  local light = vim.o.background == 'light'
  for name, colors in pairs({ Working = { light and '#006b32' or '#67d391', 2 }, Waiting = { light and '#805800' or '#e8c65a', 3 },
    Stopped = { light and '#ad2020' or '#ff7777', 1 }, Complete = { light and '#1759a5' or '#81b7ff', 4 },
    Unknown = { light and '#606060' or '#aaaaaa', 8 } }) do
    api.nvim_set_hl(0, 'AgentStatus' .. name, { fg = colors[1], ctermfg = colors[2] })
  end
end
local function valid(w) return w and api.nvim_win_is_valid(w) end
local function buffer(ft)
  local b = api.nvim_create_buf(false, true)
  vim.bo[b].bufhidden, vim.bo[b].filetype, vim.bo[b].modifiable = 'hide', ft, false
  return b
end
local function lines(b, values)
  if not vim.deep_equal(api.nvim_buf_get_lines(b, 0, -1, false), values) then
    local readonly = vim.bo[b].readonly
    vim.bo[b].readonly = false
    vim.bo[b].modifiable = true
    api.nvim_buf_set_lines(b, 0, -1, false, values)
    vim.bo[b].modifiable = false
    vim.bo[b].readonly = readonly
    return true
  end
end
local function row(kind)
  local s = M.state
  if not s or not valid(s[kind]) then return end
  local line = api.nvim_win_get_cursor(s[kind])[1]
  if kind == 'ai' then
    for _, item in ipairs(s.rows) do if line >= item.first and line <= item.last then return item end end
    return
  end
  return s.reviews[math.floor((line - 1) / 4) + 1]
end
local function notify(result)
  vim.notify(result, result:match('^FAIL') and vim.log.levels.WARN or vim.log.levels.INFO)
end
local function ensure_chat(s)
  if valid(s.chat) then return true end
  if not api.nvim_tabpage_is_valid(s.tab) then return false end
  local anchor = valid(s.ai) and s.ai or api.nvim_tabpage_list_wins(s.tab)[1]
  if not anchor then return false end
  s.chat = api.nvim_open_win(s.empty, false, { split = 'right', win = anchor })
  return true
end
function M.close_session(entry)
  local s = M.state
  if not s or s.selected ~= entry.id or not ensure_chat(s) then return end
  local terminal = require('config.agent.terminal')
  local function eligible(e)
    return e and e.id ~= entry.id and not e.auto_close and e.exit_code == nil and api.nvim_buf_is_valid(e.buf)
  end
  local parent = terminal.registry[entry.parent_id]
  local candidate = eligible(parent) and parent.role == 'plan' and parent or nil
  local entries = terminal.entries()
  if not candidate then
    for _, e in ipairs(entries) do if eligible(e) and e.role == 'plan' then candidate = e; break end end
  end
  if not candidate then
    for _, e in ipairs(entries) do if eligible(e) then candidate = e; break end end
  end
  if candidate then M.select(candidate.id, false)
  else
    s.selected = nil
    api.nvim_win_set_buf(s.chat, s.empty)
    vim.wo[s.chat].winbar = ''
  end
end
function M.select(id, focus)
  local terminal = require('config.agent.terminal')
  local s, e = M.state, terminal.registry[id]
  if not s or not e or not api.nvim_buf_is_valid(e.buf) or not ensure_chat(s) then return false end
  local parent = e.role == 'plan' and e.id or ((e.role == 'work' or e.role == 'review') and e.parent_id)
  s.expanded = parent and terminal.registry[parent] and terminal.registry[parent].role == 'plan' and parent or nil
  s.selected = id
  api.nvim_win_set_buf(s.chat, e.buf)
  vim.wo[s.chat].winbar = '  ' .. terminal.display_name(e):gsub('%%', '%%%%')
  if focus then api.nvim_set_current_win(s.chat) end
  M.refresh()
  return true
end
local function select_ai()
  local r = row('ai')
  if not r then return end
  M.select(r.entry.id, true)
end
function M.select_review(id)
  local s = M.state
  if not s then return end
  for _, item in ipairs(s.reviews) do
    if item.id == id then
      s.views = s.views or {}
      if valid(s.body) and s.document then s.views[s.document] = api.nvim_win_call(s.body, vim.fn.winsaveview) end
      s.document = id; M.refresh(); return true
    end
  end
end
function M.decision(decision)
  local s = M.state
  local r = s and api.nvim_get_current_win() == s.docs and row('docs') or nil
  local id = r and r.id or (s and s.document)
  if not id then return end
  if decision == 'approved' then notify(require('config.agent.reviews').decide(id, decision))
  else
    vim.ui.input({ prompt = '수정 요청: ' }, function(text)
      if text and vim.trim(text) ~= '' then notify(require('config.agent.reviews').decide(id, decision, text)) end
    end)
  end
end
local function ensure(name, show, anchor, side, buf, title, width)
  local s = M.state
  if not show and valid(s[name]) then
    -- Restore focus to the conversation only if its own pane has disappeared.
    if api.nvim_get_current_win() == s[name] then api.nvim_set_current_win(s.chat) end
    api.nvim_win_close(s[name], true); s[name] = nil
  elseif show and not valid(s[name]) then
    s[name] = api.nvim_open_win(buf, false, { split = side, win = anchor })
    vim.wo[s[name]].number, vim.wo[s[name]].relativenumber = false, false
    vim.wo[s[name]].signcolumn, vim.wo[s[name]].winbar = 'no', title
    vim.wo[s[name]].wrap, vim.wo[s[name]].cursorline = false, true
    if width then vim.wo[s[name]].winfixwidth = true end
  end
  if show and width and valid(s[name]) then api.nvim_win_set_width(s[name], width) end
end
function M.layout()
  local s = M.state
  if not s or not api.nvim_tabpage_is_valid(s.tab) or api.nvim_get_current_tabpage() ~= s.tab or not valid(s.chat) then return end
  local cols, has = vim.o.columns, #s.reviews > 0
  ensure('docs', has and cols >= 60 and (cols >= 145 or s.show_docs), valid(s.body) and s.body or s.chat, 'right', s.docs_buf, ' 문서 목록', 26)
  ensure('body', has and not s.hide_body and cols >= 45 and (cols >= 85 or s.show_body), s.chat, 'right', s.body_buf, ' 사용자 검토')
  ensure('ai', not s.hide_ai and cols >= 45 and (cols >= 85 or s.show_ai), s.chat, 'left', s.ai_buf, ' AI 목록', 28)
  if valid(s.docs) then vim.wo[s.docs].wrap, vim.wo[s.docs].linebreak = true, true end
  if valid(s.body) then vim.wo[s.body].wrap, vim.wo[s.body].linebreak = true, true end
  if valid(s.body) then
    local remaining = cols - (valid(s.ai) and api.nvim_win_get_width(s.ai) + 1 or 0)
      - (valid(s.docs) and api.nvim_win_get_width(s.docs) + 1 or 0)
    pcall(api.nvim_win_set_width, s.chat, math.max(12, math.floor((remaining - 1) / 2)))
  end
end
function M.refresh()
  local s = M.state
  if not s or not api.nvim_tabpage_is_valid(s.tab) then return end
  local current, cursor = api.nvim_get_current_win(), api.nvim_win_get_cursor(0)
  local ai_key = row('ai')
  ai_key = ai_key and ai_key.key
  local doc_key = row('docs')
  doc_key = doc_key and doc_key.id
  local ok, items = pcall(require('config.agent.reviews').items)
  if not ok then
    if not s.review_error then notify('FAIL: ' .. tostring(items)); s.review_error = true end
    return
  end
  s.reviews, s.rows = items, {}
  local text, marks = {}, {}
  local instance = hub.snapshot()
  local plans, children, ordered, entries = {}, {}, {}, {}
  for _, e in ipairs(instance.entries) do
    entries[e.id] = e
    if e.role == 'plan' then plans[e.id] = e end
  end
  for _, e in ipairs(instance.entries) do
    if (e.role == 'work' or e.role == 'review') and plans[e.parent_id] then
      children[e.parent_id] = children[e.parent_id] or {}
      table.insert(children[e.parent_id], e)
    end
  end
  for _, e in ipairs(instance.entries) do
    if not ((e.role == 'work' or e.role == 'review') and plans[e.parent_id]) then
      table.insert(ordered, { entry = e, indent = '' })
      if s.expanded == e.id then
        for _, child in ipairs(children[e.id] or {}) do table.insert(ordered, { entry = child, indent = '  ' }) end
      end
    end
  end
  local function aggregate(e)
    local values = { activity_status(e) or 'unknown' }
    for _, child in ipairs(children[e.id] or {}) do values[#values + 1] = activity_status(child) or 'unknown' end
    local seen, all_complete = {}, true
    for _, value in ipairs(values) do
      value = status_groups[value] and value ~= 'review_pending' and value or 'unknown'
      seen[value] = true
      if value ~= 'complete' then all_complete = false end
    end
    if seen.working then return 'working' end
    if all_complete then return 'complete' end
    for _, value in ipairs({ 'error', 'interrupted', 'unknown', 'response_requested' }) do
      if seen[value] then return value end
    end
    return 'idle'
  end
  local selection_ns = api.nvim_create_namespace('agent_workspace_selection')
  api.nvim_buf_clear_namespace(s.ai_buf, selection_ns, 0, -1)
  local selected_lines = {}
  for _, item in ipairs(ordered) do
    local e = item.entry
    if item.indent == '' and #text > 0 then text[#text + 1] = '' end
    local has_children = children[e.id] and #children[e.id] > 0
    local arrow = has_children and (s.expanded == e.id and '▼ ' or '▶ ') or '  '
    local prefix = item.indent == '' and arrow or '    '
    local first = #text + 1
    text[#text + 1] = prefix .. '● ' .. e.name
    local displayed = has_children and s.expanded ~= e.id and aggregate(e) or activity_status(e)
    marks[#marks + 1] = { #text - 1, #prefix, displayed }
    text[#text + 1] = e.selecting and '' or ('  ' .. item.indent .. (e.model or '모델 확인 불가'))
    if s.selected == e.id then
      selected_lines[#selected_lines + 1] = first
      if valid(s.chat) then vim.wo[s.chat].winbar = '  ' .. e.name:gsub('%%', '%%%%') end
    end
    s.rows[#s.rows + 1] = { key = instance.instance .. '/' .. e.id, entry = e, instance = instance,
      first = first, last = #text, arrow = has_children, displayed_status = displayed }
  end
  lines(s.ai_buf, #text > 0 and text or { 'n: 새 계획 세션', 'I: 기존 외부 세션 관리' })
  for _, first in ipairs(selected_lines) do
    for line = first - 1, first do
      api.nvim_buf_set_extmark(s.ai_buf, selection_ns, line, 0, { end_row = line + 1, end_col = 0, hl_group = 'Visual', hl_eol = true, priority = 90 })
    end
  end
  api.nvim_buf_clear_namespace(s.ai_buf, status_ns, 0, -1)
  for _, mark in ipairs(marks) do
    api.nvim_buf_add_highlight(s.ai_buf, status_ns, 'AgentStatus' .. (status_groups[mark[3]] or 'Unknown'), mark[1], mark[2], mark[2] + #'●')
  end
  if not vim.tbl_contains(vim.tbl_map(function(i) return i.id end, items), s.document) then s.document = items[1] and items[1].id end
  local titles = {}
  local review_labels = { review_pending = '검토 대기', approved = '승인·진행', changes_requested = '수정 요청' }
  for _, item in ipairs(items) do
    titles[#titles + 1] = (s.document == item.id and '> ' or '') .. '[' .. (review_labels[item.status] or '확인 불가') .. '] ' .. vim.fn.fnamemodify(item.path, ':t:r')
    titles[#titles + 1] = ''
    local owner = entries[item.owner]
    local plan = owner and owner.task_id == item.task_id and (owner.role == 'plan' and owner
      or ((owner.role == 'work' or owner.role == 'review') and owner.parent_id == item.parent_id and plans[item.parent_id]))
    titles[#titles + 1] = '  ' .. (plan and not plan.selecting and plan.name and vim.trim(plan.name) ~= '' and plan.name or '계획 제목 확인 불가')
    titles[#titles + 1] = ''
  end
  lines(s.docs_buf, #titles > 0 and titles or { '검토 문서 없음' })
  local body_changed
  for _, item in ipairs(items) do
    if item.id == s.document then
      body_changed = lines(s.body_buf, vim.fn.filereadable(item.path) == 1 and vim.fn.readfile(item.path) or { '문서 파일을 읽을 수 없습니다: ' .. item.path })
    end
  end
  M.layout()
  local document_changed = s.rendered_document ~= s.document
  s.rendered_document = s.document
  for kind, key in pairs({ ai = ai_key or '', docs = doc_key or '' }) do
    for i, value in ipairs(kind == 'ai' and s.rows or items) do
      if (value.key or value.id) == key and valid(s[kind]) then api.nvim_win_set_cursor(s[kind], { kind == 'ai' and value.first or (i - 1) * 4 + 1, 0 }); break end
    end
  end
  if valid(current) and api.nvim_get_current_win() == current and current ~= s.ai and current ~= s.docs
    and not (document_changed and current == s.body) then
    pcall(api.nvim_win_set_cursor, current, cursor)
  end
  if document_changed and valid(s.body) then
    api.nvim_win_call(s.body, function() vim.fn.winrestview((s.views or {})[s.document] or { lnum = 1, col = 0, topline = 1 }) end)
  end
  -- TextChanged does not fire for the review buffer while the terminal has focus.
  local markdown = package.loaded['render-markdown']
  if body_changed and valid(s.body) and markdown and markdown.render then
    markdown.render({ buf = s.body_buf, win = s.body })
  end
end
function M.open(focus_list)
  if M.state and api.nvim_tabpage_is_valid(M.state.tab) then
    api.nvim_set_current_tabpage(M.state.tab)
    M.refresh()
  else
    vim.cmd('tabnew')
    local s = { tab = api.nvim_get_current_tabpage(), chat = api.nvim_get_current_win(), rows = {}, reviews = {} }
    M.state = s
    vim.t.agent_workspace = true
    vim.treesitter.language.register('markdown', 'agent_review_markdown')
    local lazy_ok, lazy = pcall(require, 'lazy')
    if lazy_ok then lazy.load({ plugins = { 'render-markdown.nvim' } }) end
    s.ai_buf, s.docs_buf, s.body_buf = buffer('agent_hub'), buffer('agent_reviews'), buffer('agent_review_markdown')
    vim.bo[s.body_buf].readonly = true
    s.empty = buffer('agent_chat')
    lines(s.empty, { 'AI 작업 공간', '', 'Agent / AgentNew: 계획 시작', 'AgentList: AI 목록', 'AgentDocuments: 문서 목록',
      'Alt+h/j/k/l · Ctrl+w: 영역 이동', 'AgentInstances: 기존 외부 세션 관리' })
    api.nvim_win_set_buf(s.chat, s.empty)
    local function map(b, key, fn, desc) vim.keymap.set('n', key, fn, { buffer = b, silent = true, desc = desc }) end
    local function toggle(r)
      if r and r.arrow then
        if s.expanded == r.entry.id then s.expanded = nil else s.expanded = r.entry.id end
        M.refresh()
      end
    end
    map(s.ai_buf, '<Space>', function() toggle(row('ai')) end, '계획 접기/펼치기')
    map(s.ai_buf, '<CR>', select_ai, '선택 AI 대화')
    map(s.ai_buf, 'n', function() require('config.agent.launcher').menu() end, '새 계획')
    map(s.ai_buf, 'I', function() require('config.agent.panel').open() end, '외부 세션 관리')
    map(s.ai_buf, 'R', M.refresh, '목록 갱신')
    for key, action in pairs({ r = 'rename', s = 'shared', X = 'stop' }) do
      map(s.ai_buf, key, function() local r = row('ai'); if r then require('config.agent.panel')[action](r) end end, '작업 ' .. action)
    end
    map(s.ai_buf, 'a', function()
      local r = row('ai')
      if r then require('config.agent.launcher').menu({ task_id = r.entry.task_id, cwd = r.entry.cwd, name = r.entry.name }) end
    end, '같은 작업의 새 세션')
    for _, key in ipairs({ 'q', '<Esc>' }) do
      map(s.ai_buf, key, function() s.hide_ai = true; M.layout() end, 'AI 목록 숨김')
    end
    map(s.docs_buf, '<CR>', function() local r = row('docs'); if r then M.select_review(r.id) end end, '검토 문서 선택')
    for _, b in ipairs({ s.docs_buf, s.body_buf }) do
      map(b, 'a', function() M.decision('approved') end, '승인·진행')
      map(b, 'r', function() M.decision('changes_requested') end, '수정 요청')
    end
    map(s.body_buf, '<C-d>', function() s.hide_body = true; if valid(s.body) then api.nvim_win_close(s.body, true); s.body = nil end end, '본문 숨김 (승인 아님)')
    for _, b in ipairs({ s.ai_buf, s.docs_buf, s.body_buf }) do
      map(b, '?', function()
        local message = 'AI: Space 접기/펼치기 · Enter 대화 · n 새 작업 · I 외부 관리 | 문서: Enter 선택 · a 승인 · r 수정 | AgentDocuments/AgentDocument: 숨긴 영역 표시 · Alt+h/l 이동'
        local r = b == s.ai_buf and row('ai') or nil
        if r then
          local labels = require('config.agent.activity').labels
          message = message .. '\n상태: ' .. (labels[r.displayed_status] or labels.unknown)
        end
        vim.notify(message)
      end, '작업 공간 도움말')
    end
    for _, kind in ipairs({ 'ai', 'docs' }) do
      local b = s[kind .. '_buf']
      for key, delta in pairs({ j = 1, k = -1, ['<Down>'] = 1, ['<Up>'] = -1 }) do
        map(b, key, function()
          if not valid(s[kind]) then return end
          local stride = 4
          local count = #(kind == 'ai' and s.rows or s.reviews)
          if count == 0 then return end
          local index = math.floor((api.nvim_win_get_cursor(s[kind])[1] - 1) / stride) + 1
          if kind == 'ai' then
            local current = row('ai')
            index = current and (vim.fn.index(s.rows, current) + 1) or 0
            if not current then
              local line = api.nvim_win_get_cursor(s.ai)[1]
              for i, item in ipairs(s.rows) do
                if item.last < line then index = i else break end
              end
              if delta < 0 then index = index + 1 end
            end
          end
          local target = math.max(1, math.min(count, index + delta))
          api.nvim_win_set_cursor(s[kind], { kind == 'ai' and s.rows[target].first or (target - 1) * stride + 1, 0 })
        end, '목록 항목 이동')
      end
    end
    local group = api.nvim_create_augroup('agent_workspace', { clear = true })
    -- Observe the native mouse action instead of replacing user mouse/key mappings.
    vim.on_key(function(key, typed)
      if typed == "" then return end
      local mouse_key = api.nvim_replace_termcodes('<LeftMouse>', true, false, true)
      if key:sub(1, #mouse_key) ~= mouse_key then return end
      local previous, mouse = api.nvim_get_current_win(), vim.fn.getmousepos()
      local clicked
      if mouse.winid == s.ai then
        for _, item in ipairs(s.rows) do if mouse.line >= item.first and mouse.line <= item.last then clicked = item; break end end
      end
      vim.schedule(function()
        if M.state ~= s then return end
        if mouse.winid == s.ai then
          local r = clicked
          if r and r.arrow and mouse.line == r.first and mouse.column <= 2 then
            toggle(r)
            if valid(previous) then api.nvim_set_current_win(previous) end
          elseif r then M.select(r.entry.id, true) end
        elseif mouse.winid == s.docs then local r = row('docs'); if r then M.select_review(r.id) end end
      end)
    end, api.nvim_create_namespace('agent_workspace_mouse'))
    status_highlights()
    api.nvim_create_autocmd('ColorScheme', { group = group, callback = status_highlights })
    api.nvim_create_autocmd({ 'VimResized', 'TabEnter' }, { group = group, callback = function() vim.schedule(M.refresh) end })
    s.timer = vim.uv.new_timer()
    s.timer:start(1000, 1000, vim.schedule_wrap(function()
      if not api.nvim_tabpage_is_valid(s.tab) then s.timer:stop(); s.timer:close(); if M.state == s then M.state = nil end; return end
      M.refresh()
    end))
    M.refresh()
    local entries = require('config.agent.terminal').entries()
    if #entries > 0 then M.select(entries[#entries].id, false) end
  end
  if focus_list then M.show('ai') end
end
function M.show(kind)
  M.open(false)
  local s = M.state
  s['show_' .. kind] = true
  if kind == 'body' then s.hide_body = false end
  if kind == 'ai' then s.hide_ai = false end
  M.layout()
  if valid(s[kind]) then api.nvim_set_current_win(s[kind]) end
end
function M.active() return M.state and api.nvim_tabpage_is_valid(M.state.tab) end
function M.spawn_window()
  if not M.active() then return false end
  if not ensure_chat(M.state) then return false end
  api.nvim_set_current_tabpage(M.state.tab)
  api.nvim_set_current_win(M.state.chat)
  vim.cmd('enew')
  return true
end
return M
