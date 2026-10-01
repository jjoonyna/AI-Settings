-- 모든 등록된 Neovim의 작업을 한 목록으로 표시한다.
local M = {}
local hub = require('config.agent.hub')
local state

function M.close()
  if not state then return end
  local old = state
  state = nil
  if old.timer then old.timer:stop(); old.timer:close() end
  if vim.api.nvim_win_is_valid(old.win) then vim.api.nvim_win_close(old.win, true) end
  if vim.api.nvim_buf_is_valid(old.buf) then vim.api.nvim_buf_delete(old.buf, { force = true }) end
end

local function selected()
  if not state or not vim.api.nvim_win_is_valid(state.win) then return end
  return state.rows[math.floor((vim.api.nvim_win_get_cursor(state.win)[1] - 1) / 3) + 1]
end

local function render()
  if not state or not vim.api.nvim_buf_is_valid(state.buf) then return end
  local key = selected() and selected().key
  local lines, rows = {}, {}
  for _, instance in ipairs(state.instances) do
    local entries = #instance.entries > 0 and instance.entries or { { name = '빈 세션', cwd = instance.cwd } }
    for _, e in ipairs(entries) do
      local connection = instance.connected == false and '연결 확인 필요'
        or ((instance.uis or 0) > 0 and '화면 연결' or '백그라운드')
      local owner = instance.instance == hub.id and '현재 창' or ('창 ' .. instance.instance)
      lines[#lines + 1] = string.format('%s  |  %s%s  |  %s', e.name, e.agent or 'Neovim', e.id and (' #' .. e.id) or '', connection)
      lines[#lines + 1] = string.format('  %s · 실행 시 브랜치: %s', owner, e.branch or '없음')
      lines[#lines + 1] = '  ' .. (e.cwd or '')
      rows[#rows + 1] = { key = instance.instance .. '/' .. tostring(e.id), instance = instance, entry = e }
    end
  end
  if #lines == 0 then lines = { '등록된 작업이 없습니다. n으로 새 유지 세션을 열 수 있습니다.' } end
  state.rows = rows
  vim.bo[state.buf].modifiable = true
  vim.api.nvim_buf_set_lines(state.buf, 0, -1, false, lines)
  vim.bo[state.buf].modifiable = false
  for i, row in ipairs(rows) do
    if row.key == key then vim.api.nvim_win_set_cursor(state.win, { (i - 1) * 3 + 1, 0 }); break end
  end
end

function M.refresh()
  if not state then return end
  hub.publish()
  local current = state
  current.generation = (current.generation or 0) + 1
  local generation = current.generation
  current.instances = hub.instances()
  render()
  for i, instance in ipairs(current.instances) do
    hub.rpc(instance, 'snapshot', {}, function(response)
      if state ~= current or current.generation ~= generation then return end
      if response.ok then current.instances[i] = response.data; current.instances[i].connected = true
      else instance.connected = false end
      render()
    end)
  end
end

local function focus()
  local row = selected()
  if not row then return end
  M.close()
  hub.rpc(row.instance, 'focus', { id = row.entry.id }, function(response)
    if not response.ok then vim.notify(response.error, vim.log.levels.WARN); return end
    if row.instance.instance ~= hub.id then
      hub.rpc(row.instance, 'snapshot', {}, function(snapshot)
        if snapshot.ok then require('config.agent.launcher').attach(snapshot.data)
        else vim.notify(snapshot.error, vim.log.levels.WARN) end
      end)
    end
  end)
end

local function rename()
  local row = selected()
  if not row or not row.entry.id then return end
  vim.ui.input({ prompt = '작업 이름: ', default = row.entry.name }, function(name)
    if not name then return end
    hub.rpc(row.instance, 'rename', { id = row.entry.id, name = name }, function(response)
      if not response.ok then vim.notify(response.error, vim.log.levels.WARN) end
      M.refresh()
    end)
  end)
end

local function shared()
  local row = selected()
  if not row or not hub.valid_id(row.entry.task_id) then return end
  local dir = hub.root() .. '/tasks/' .. row.entry.task_id
  local paths = vim.fn.glob(dir .. '/*.md', false, true)
  M.close()
  vim.ui.select(paths, { prompt = '공유 기록', format_item = function(path)
    local stat = vim.uv.fs_stat(path)
    return vim.fn.fnamemodify(path, ':t') .. '  ' .. (stat and os.date('%m-%d %H:%M', stat.mtime.sec) or '')
  end }, function(path) if path then vim.cmd('edit ' .. vim.fn.fnameescape(path)) end end)
end

local function stop()
  local row = selected()
  if not row then return end
  if not row.instance.managed then vim.notify('일반 Neovim은 여기서 종료하지 않습니다'); return end
  local names = {}
  for _, entry in ipairs(row.instance.entries) do names[#names + 1] = entry.name end
  vim.ui.select({ '취소', '이 세션과 모든 작업 종료' }, {
    prompt = '종료 대상: ' .. table.concat(names, ', ') .. ' — 화면만 닫으려면 :AgentDetach',
  }, function(_, index)
    if index ~= 2 then return end
    hub.rpc(row.instance, 'stop', {}, function(response)
      if not response.ok then vim.notify(response.error, vim.log.levels.WARN) end
      vim.defer_fn(M.refresh, 300)
    end)
  end)
end

function M.open()
  if state and vim.api.nvim_win_is_valid(state.win) then vim.api.nvim_set_current_win(state.win); return end
  local buf = vim.api.nvim_create_buf(false, true)
  local width = math.max(20, math.min(120, vim.o.columns - 4))
  local height = math.max(3, math.min(24, vim.o.lines - 5))
  local win = vim.api.nvim_open_win(buf, true, { relative = 'editor', width = width, height = height,
    row = math.max(0, math.floor((vim.o.lines - height) / 2) - 1), col = math.max(0, math.floor((vim.o.columns - width) / 2)),
    style = 'minimal', border = 'rounded', title = ' 작업 목록 ',
    footer = ' Enter 이동 · r 이름 · s 기록 · a 같은 작업 · n 새 창 · R 갱신 · X 종료 · q 닫기 ', footer_pos = 'center' })
  state = { buf = buf, win = win, rows = {}, instances = {} }
  vim.bo[buf].filetype = 'agent_hub'
  vim.bo[buf].bufhidden = 'wipe'
  vim.wo[win].wrap = false
  vim.wo[win].cursorline = true
  vim.wo[win].winbar = ''
  local function map(key, fn) vim.keymap.set('n', key, fn, { buffer = buf, nowait = true, silent = true }) end
  for _, key in ipairs({ 'q', '<Esc>' }) do map(key, M.close) end
  map('<CR>', focus); map('r', rename); map('s', shared); map('R', M.refresh); map('X', stop)
  map('n', function() M.close(); require('config.agent.launcher').menu() end)
  map('a', function()
    local row = selected()
    if not row or not row.entry.task_id then return end
    M.close()
    require('config.agent.launcher').menu({ task_id = row.entry.task_id, cwd = row.entry.cwd, name = row.entry.name })
  end)
  for key, delta in pairs({ j = 1, k = -1, ['<Down>'] = 1, ['<Up>'] = -1 }) do
    map(key, function()
      if not state or #state.rows == 0 then return end
      local index = math.floor((vim.api.nvim_win_get_cursor(win)[1] - 1) / 3) + 1
      index = math.max(1, math.min(#state.rows, index + delta))
      vim.api.nvim_win_set_cursor(win, { (index - 1) * 3 + 1, 0 })
    end)
  end
  vim.api.nvim_create_autocmd('WinClosed', { pattern = tostring(win), once = true,
    callback = function() vim.schedule(function() if state and state.win == win then M.close() end end) end })
  state.timer = vim.uv.new_timer()
  state.timer:start(5000, 5000, vim.schedule_wrap(M.refresh))
  M.refresh()
end

return M

