-- Neovim 인스턴스별 등록과 작업별 공유 기록을 관리한다.
local M = {}
local uv = vim.uv
local timer
local started = false

function M.root()
  return vim.env.AGENT_HUB_HOME or (vim.fn.stdpath('state') .. '/agent-hub')
end

function M.uid()
  return ('%x-%x-%x'):format(os.time(), vim.fn.getpid(), uv.hrtime() % 0x100000000)
end

function M.valid_id(id)
  return type(id) == 'string' and id:match('^[%w_-]+$') ~= nil and #id < 100
end

function M.read(path)
  local ok, value = pcall(function()
    return vim.json.decode(table.concat(vim.fn.readfile(path), '\n'))
  end)
  return ok and type(value) == 'table' and value or nil
end

function M.write(path, value)
  vim.fn.mkdir(vim.fn.fnamemodify(path, ':h'), 'p')
  local temp = path .. '.' .. M.uid() .. '.tmp'
  local ok, err = pcall(function()
    vim.fn.writefile({ vim.json.encode(value) }, temp)
    local renamed, reason = uv.fs_rename(temp, path)
    assert(renamed, reason)
  end)
  if not ok then
    pcall(uv.fs_unlink, temp)
    return false, tostring(err)
  end
  return true
end

function M.task(task_id, name, cwd, plan)
  task_id = task_id or M.uid()
  assert(M.valid_id(task_id), '잘못된 작업 식별자')
  local dir = M.root() .. '/tasks/' .. task_id
  local path = dir .. '/task.json'
  local task = M.read(path)
  if not task then
    assert(not uv.fs_stat(path), '작업 정보 파일이 손상되었습니다')
    task = { id = task_id, name = name or '이름 없는 작업', cwd = cwd, plan = plan, created = os.time() }
    assert(M.write(path, task))
    vim.fn.writefile({ '# ' .. task.name, '', '## 작업 위치', cwd or '', '',
      '## 설계·계획', plan or '지정하지 않음', '',
      '## 공유 방법', '각 에이전트는 자기 기록 파일에 목표·확정 결정·진행 결과·변경 파일·미해결 항목을 기록한다.',
      '다른 에이전트의 기록을 읽어 최신 결정을 확인한다. 대화 전체가 자동 공유되지는 않는다.', '',
      '## 기존 공유 기록', (cwd or '') .. '/.agent-shared.md',
    }, dir .. '/README.md')
  end
  return task, dir
end

function M.note(entry)
  local task, dir = M.task(entry.task_id, entry.name, entry.cwd)
  entry.task_id = task.id
  entry.note = dir .. '/' .. M.id .. '-' .. entry.id .. '.md'
  if not uv.fs_stat(entry.note) then
    vim.fn.writefile({ '# ' .. entry.name, '', '상태: 기록 대기', '',
      '## 목표', '', '## 확정 결정', '', '## 진행 결과', '', '## 변경 파일', '', '## 미해결 항목', '',
    }, entry.note)
  end
  return entry.note
end

function M.snapshot()
  local entries = {}
  for _, e in ipairs(require('config.agent.terminal').entries()) do
    entries[#entries + 1] = { id = e.id, name = e.name, agent = e.agent or '에이전트', cwd = e.cwd,
      branch = e.branch, task_id = e.task_id, note = e.note, buf = e.buf }
  end
  return { version = 1, instance = M.id, pid = vim.fn.getpid(), server = vim.v.servername,
    managed = M.managed, window = M.window,
    updated = os.time(), uis = #vim.api.nvim_list_uis(), cwd = vim.fn.getcwd(), entries = entries }
end

function M.publish()
  if not started or vim.v.exiting ~= vim.NIL then return end
  local ok, err = M.write(M.root() .. '/instances/' .. M.id .. '.json', M.snapshot())
  if not ok and not M.write_warned then
    M.write_warned = true
    vim.notify('작업 목록 저장 실패: ' .. err, vim.log.levels.WARN)
  end
end

function M.instances()
  local result = {}
  for _, path in ipairs(vim.fn.glob(M.root() .. '/instances/*.json', false, true)) do
    local item = M.read(path)
    if item and item.version == 1 and M.valid_id(item.instance) and type(item.server) == 'string'
      and type(item.entries) == 'table' then
      result[#result + 1] = item
    end
  end
  table.sort(result, function(a, b) return a.instance < b.instance end)
  return result
end

function M.rpc(instance, action, args, callback)
  local request = { instance = instance.instance, action = action, args = args or {} }
  if instance.instance == M.id then
    local ok, response = pcall(M.dispatch, request)
    callback(ok and response or { ok = false, error = tostring(response) })
    return
  end
  vim.system({ vim.v.progpath, '--headless', '-u', 'NONE', '-i', 'NONE', '-l',
    vim.fn.stdpath('config') .. '/scripts/agent-hub-rpc.lua', instance.server },
    { stdin = vim.json.encode(request), text = true, timeout = 2500 },
    vim.schedule_wrap(function(result)
      local ok, response = pcall(vim.json.decode, result.stdout or '')
      if result.code ~= 0 or not ok or type(response) ~= 'table' then
        callback({ ok = false, error = '연결할 수 없거나 응답 시간이 초과되었습니다' })
      else
        callback(response)
      end
    end))
end

function M.dispatch(request)
  if request.instance ~= M.id then return { ok = false, error = '다른 Neovim 인스턴스입니다' } end
  local T = require('config.agent.terminal')
  local a = request.args or {}
  if request.action == 'snapshot' then
    return { ok = true, data = M.snapshot() }
  elseif request.action == 'rename' then
    local ok, err = T.rename(a.id, a.name)
    return { ok = ok, error = err }
  elseif request.action == 'focus' then
    if not a.id then return { ok = true } end
    return { ok = T.focus(a.id), error = '대상 터미널이 종료되었습니다' }
  elseif request.action == 'stop' then
    if not M.managed then
      return { ok = false, error = '일반 Neovim은 작업 목록에서 종료하지 않습니다' }
    end
    for _, b in ipairs(vim.api.nvim_list_bufs()) do
      if vim.bo[b].modified then return { ok = false, error = '저장하지 않은 버퍼가 있어 종료하지 않았습니다' } end
    end
    vim.defer_fn(function() vim.cmd('qa!') end, 100)
    return { ok = true }
  end
  return { ok = false, error = '지원하지 않는 작업입니다' }
end

function M.setup()
  if started then return end
  started = true
  M.id = vim.env.AGENT_HUB_INSTANCE or M.uid()
  M.managed = vim.env.AGENT_HUB_MANAGED == '1'
  M.window = vim.env.AGENT_HUB_WINDOW
  local startup_request = vim.env.AGENT_HUB_REQUEST
  -- 자식 프로세스가 새 Neovim을 열 때 부모 식별자를 재사용하지 않도록 한다.
  vim.env.AGENT_HUB_INSTANCE = nil
  vim.env.AGENT_HUB_MANAGED = nil
  vim.env.AGENT_HUB_WINDOW = nil
  vim.env.AGENT_HUB_REQUEST = nil
  assert(M.valid_id(M.id), '잘못된 인스턴스 식별자')
  if vim.v.servername == '' then vim.fn.serverstart('\\\\.\\pipe\\agent-hub-' .. M.id) end
  local T = require('config.agent.terminal')
  require('config.agent.bridge').install(T)
  for _, entry in ipairs(T.entries()) do if not entry.note then M.note(entry) end end
  require('config.agent.plan_preview').setup()
  local group = vim.api.nvim_create_augroup('agent_hub_registry', { clear = true })
  vim.api.nvim_create_autocmd({ 'UIEnter', 'UILeave', 'TermClose' }, {
    group = group, callback = function() vim.schedule(M.publish) end,
  })
  vim.api.nvim_create_autocmd('VimLeavePre', { group = group, callback = function()
    if timer then timer:stop(); timer:close(); timer = nil end
    pcall(uv.fs_unlink, M.root() .. '/instances/' .. M.id .. '.json')
  end })
  timer = uv.new_timer()
  timer:start(0, 5000, vim.schedule_wrap(M.publish))
  M.publish()
  _G.AgentHubNew = function(opts) return require('config.agent.launcher').new(opts) end
  _G.AgentHubStatus = function() return vim.json.encode(M.instances()) end
  if startup_request then
    vim.schedule(function() require('config.agent.launcher').consume(startup_request) end)
  end
end

return M


