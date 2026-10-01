-- 백그라운드 Neovim과 화면 연결을 별도로 실행한다.
local M = {}
local hub = require('config.agent.hub')

local function report(text, error)
  vim.notify(text, error and vim.log.levels.ERROR or vim.log.levels.INFO)
end

function M.attach(instance, callback)
  callback = callback or function(ok, err) if not ok then report(err, true) end end
  if not instance.managed then
    callback(true)
    report('대상 Neovim에서 터미널을 선택했습니다. 해당 Windows 창으로 전환하세요.')
    return
  end
  local wt = vim.fn.exepath('wt.exe')
  -- Windows 실행 별칭은 exepath 검사에서 누락될 수 있다.
  if wt == '' then wt = (vim.env.LOCALAPPDATA or vim.fn.expand('~/AppData/Local')) .. '/Microsoft/WindowsApps/wt.exe' end
  if wt == '' then callback(false, 'Windows Terminal을 찾을 수 없습니다'); return end
  local cmd = { wt, '-w', instance.window }
  if (instance.uis or 0) > 0 then
    vim.list_extend(cmd, { 'focus-tab', '--target', '0' })
  else
    vim.list_extend(cmd, { 'new-tab', '--title', '작업 ' .. instance.instance,
      vim.v.progpath, '--server', instance.server, '--remote-ui' })
  end
  vim.system(cmd, { text = true, timeout = 5000 }, vim.schedule_wrap(function(result)
    if result.code ~= 0 then callback(false, '화면 연결 실패: ' .. (result.stderr or '')); return end
    local attempts = 0
    local function check()
      hub.rpc(instance, 'snapshot', {}, function(response)
        if response.ok and response.data.uis > 0 then callback(true); return end
        attempts = attempts + 1
        if attempts >= 8 then callback(false, '작업은 살아 있지만 화면 연결을 확인하지 못했습니다'); return end
        vim.defer_fn(check, 500)
      end)
    end
    check()
  end))
end

function M.context(entry, opts)
  return table.concat({
    '작업 이름: ' .. entry.name,
    '작업 위치: ' .. entry.cwd,
    '공유 작업 식별자: ' .. entry.task_id,
    '공유 폴더: ' .. hub.root() .. '/tasks/' .. entry.task_id,
    '자신의 진행 기록: ' .. entry.note,
    '먼저 공유 폴더의 README.md와 다른 에이전트 기록, 작업 폴더의 .agent-shared.md가 있으면 읽으세요.',
    '자기 기록에 목표·확정 결정·진행 결과·변경 파일·미해결 항목을 한국어로 갱신하세요. 다른 에이전트 기록은 덮어쓰지 마세요.',
    '새 계획 문서를 작성하면 v:lua.AgentPlanPreview(문서의 절대 경로)로 검토 창을 열 수 있습니다.',
    opts.plan_doc and ('설계·계획 문서: ' .. opts.plan_doc) or '',
    opts.prompt or '구체적인 작업 지시가 없으면 공유 기록을 확인하고 사용자 지시를 기다리세요.',
  }, '\n')
end

function M.consume(path)
  local request = hub.read(path)
  if not request or request.instance ~= hub.id then return end
  if M.consumed then return end
  M.consumed = true
  vim.env.AGENT_HUB_REQUEST = nil
  local response = { ok = false }
  local ok, err = pcall(function()
    local menu = require('config.agent.menu')
    local cmd = request.test_cmd or menu.cmd_for(request.agent, request.session)
    assert(cmd and vim.fn.executable(cmd[1]) == 1, '에이전트 실행 파일을 찾을 수 없습니다')
    local git = vim.system({ 'git', '-C', request.cwd, 'branch', '--show-current' }, { text = true }):wait(2000)
    local branch = git.code == 0 and vim.trim(git.stdout or '') or nil
    local id, why = require('config.agent.terminal').spawn({
      cmd = cmd, cwd = request.cwd, branch = branch,
      env = { AGENT_SESSION_ROLE = request.session }, -- Stop 훅은 work 세션만 닫는다
      agent = request.agent == 'codex' and 'Codex' or (request.test_cmd and '테스트' or 'Claude'),
      name = request.name, task_id = request.task_id,
      initial_prompt = not request.test_cmd and function(entry) return M.context(entry, request) end or nil,
    })
    assert(id, why)
    response = { ok = true, id = id, instance = hub.id }
  end)
  if not ok then response.error = tostring(err) end
  hub.write(path .. '.result', response)
  hub.publish()
end

function M.new(opts, callback)
  opts = opts or {}
  callback = callback or function(ok, result) report(ok and '새 작업 세션을 열었습니다' or tostring(result), not ok) end
  local cwd = vim.fn.fnamemodify(opts.cwd or vim.fn.getcwd(), ':p'):gsub('[/\\]+$', '')
  if vim.fn.isdirectory(cwd) == 0 then return '실패: 작업 폴더가 없습니다' end
  local id = opts.request_id or hub.uid()
  if not hub.valid_id(id) then return '실패: 잘못된 요청 식별자' end
  local path = hub.root() .. '/requests/' .. id .. '.json'
  if vim.uv.fs_stat(path) then return '이미 등록된 요청: ' .. id end
  local agent = opts.agent or 'claude'
  local session = opts.session or 'plan'
  if not opts.test_cmd and not require('config.agent.menu').cmd_for(agent, session) then
    return '실패: 알 수 없는 에이전트 또는 세션 종류'
  end
  local task = hub.task(opts.task_id, opts.name or '새 작업', cwd, opts.plan_doc)
  local request = { action = 'server', instance = id, root = hub.root(), cwd = cwd,
    window = 'agent-hub-' .. id, server = '\\\\.\\pipe\\agent-hub-' .. id,
    init = vim.fn.stdpath('config') .. '/init.lua', nvim = vim.v.progpath,
    agent = agent, session = session, name = opts.name or task.name, task_id = task.id,
    prompt = opts.prompt, plan_doc = opts.plan_doc, test_cmd = opts.test_cmd }
  vim.fn.mkdir(vim.fn.fnamemodify(path, ':h'), 'p')
  local fd, err = vim.uv.fs_open(path, 'wx', 384)
  if not fd then return '실패: 이미 등록된 요청이거나 저장할 수 없습니다: ' .. tostring(err) end
  local written, why = vim.uv.fs_write(fd, vim.json.encode(request), 0)
  vim.uv.fs_close(fd)
  if not written then return '실패: ' .. tostring(why) end
  vim.system({ 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    vim.fn.stdpath('config') .. '/scripts/agent-hub-launch.ps1', '-Request', path },
    { text = true, timeout = 10000 }, vim.schedule_wrap(function(result)
      if result.code ~= 0 then callback(false, '서버 시작 실패: ' .. (result.stderr or '')); return end
      local attempts = 0
      local function ready()
        local status = hub.read(path .. '.result')
        local instance = hub.read(hub.root() .. '/instances/' .. id .. '.json')
        if status and not status.ok then callback(false, status.error); return end
        if status and status.ok and instance then
          if opts.no_ui then callback(true, instance) else M.attach(instance, function(ok, why) callback(ok, ok and instance or why) end) end
          return
        end
        attempts = attempts + 1
        if attempts >= 30 then callback(false, '서버 준비 시간을 초과했습니다. 작업 목록에서 상태를 확인하세요'); return end
        vim.defer_fn(ready, 500)
      end
      ready()
    end))
  return '시작 요청 등록: ' .. id
end

function M.menu(defaults)
  defaults = defaults or {}
  local agents = require('config.agent.menu').AGENTS
  vim.ui.select(agents, { prompt = '새 유지 세션의 에이전트', format_item = function(a) return a.label end }, function(agent)
    if not agent then return end
    vim.ui.select({ '계획', '작업' }, { prompt = '세션 종류' }, function(mode)
      if not mode then return end
      vim.ui.input({ prompt = '작업 폴더: ', default = defaults.cwd or vim.fn.getcwd(), completion = 'dir' }, function(cwd)
        if not cwd then return end
        vim.ui.input({ prompt = '작업 이름: ', default = defaults.name }, function(name)
          if not name or vim.trim(name) == '' then return end
          local result = M.new({ agent = agent.key, session = mode == '계획' and 'plan' or 'work', cwd = cwd, name = vim.trim(name), task_id = defaults.task_id })
          report(result, result:find('실패:', 1, true) ~= nil)
        end)
      end)
    end)
  end)
end

return M


