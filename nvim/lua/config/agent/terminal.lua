-- 에이전트 터미널을 만들고 이름을 붙여 관리한다.
-- 이름을 붙이는 이유(설계 §4-2-6-2): 터미널이 여러 개일 때
-- 어느 worktree/브랜치의 세션인지 모르면 엉뚱한 곳에 프롬프트를 보내게 된다.

local M = {}

--- id -> { id, name, agent, cwd, branch, chan, buf }
M.registry = {}

--- 에이전트별 일련번호
local counter = {}
local next_id = 0

--- "Claude#1 (chore/redesign-ui)" 형태의 이름을 만든다.
--- @param agent string
--- @param branch string|nil
--- @return string
local function make_name(agent, branch)
  counter[agent] = (counter[agent] or 0) + 1
  return string.format("%s#%d (%s)", agent, counter[agent], branch or "?")
end

--- 죽은 터미널을 레지스트리에서 뺀다.
--- @param chan integer
local function unregister_by_chan(chan)
  for id, e in pairs(M.registry) do
    if e.chan == chan then
      M.registry[id] = nil
      return
    end
  end
end

function M.display_name(entry)
  local selecting = entry.resume == 'resume' and not entry.cli_session and entry.exit_code == nil
  return selecting and '세션 선택 중' or entry.name, selecting
end

--- 현재 창이 LazyVim 대시보드(snacks dashboard)인지.
--- 대시보드 위에서 세션을 열면 옆에 분할하지 않고 그 자리를 덮어써서
--- 첫 화면이 남아 있지 않게 한다.
--- @return boolean
local function on_dashboard()
  return vim.bo.filetype == "snacks_dashboard"
end

--- 터미널을 새 창에 띄우고 레지스트리에 등록한다.
--- @param opts table { agent=string, cmd=string[], cwd=string, branch=string|nil, split=string|nil, env=table|nil }
---   env — 자식 프로세스에 추가할 환경변수. 핸드오프·메뉴·런처는 { AGENT_SESSION_ROLE = "work"|"plan" } 을 넘긴다.
---   Stop 훅(agent-done.js)은 AGENT_SESSION_ROLE=work 인 세션만 닫으므로, 계획 세션이 완료 마커 문자열을
---   인용해도 스스로 닫히지 않는다(2026-09-21 사고 뒤 도입).
--- @return integer|nil id, string|nil err
function M.spawn(opts)
  if type(opts.cmd) ~= "table" or #opts.cmd == 0 then
    return nil, "cmd 가 비었다"
  end

  -- vsplit 만 하면 현재 버퍼가 복제된다. enew 로 빈 버퍼를 만든 뒤 터미널로 바꾼다.
  -- 대시보드 위라면 분할하지 않고 그 창에서 바로 연다.
  if require('config.agent.workspace').spawn_window() then
    -- The conversation pane replaces its buffer; other jobs remain hidden.
  elseif on_dashboard() then
    vim.cmd("enew")
  else
    vim.cmd((opts.split or "vsplit") .. " | enew")
  end

  local env = vim.fn.environ()
  for key in pairs(env) do
    local upper=key:upper()
    if (upper:match('^AGENT_') and upper~='AGENT_HUB_HOME') or upper=='CODEX_THREAD_ID' or upper=='CODEX_SESSION_ID'
      or upper=='CLAUDE_SESSION_ID' or upper:match('^CLAUDE_CODE_MESSAGING_') or upper:match('^CLAUDE_CODE_SESSION_') then env[key]=nil end
  end
  for key,value in pairs(opts.env or {}) do
    local upper=key:upper()
    if upper~='CODEX_THREAD_ID' and upper~='CODEX_SESSION_ID' and upper~='CLAUDE_SESSION_ID'
      and not upper:match('^CLAUDE_CODE_MESSAGING_') and not upper:match('^CLAUDE_CODE_SESSION_') then env[key]=value end
  end
  env.NVIM=vim.v.servername
  env.AGENT_SESSION_ID = tostring(next_id + 1)
  local event_token = require('config.agent.hub').uid()
  env.AGENT_EVENT_TOKEN = event_token
  env.AGENT_EVENT_INSTANCE = require('config.agent.hub').id
  env.AGENT_EVENT_STARTED = tostring(os.time() * 1000)
  local prepared,prepare_error=require('config.agent.message_transport').prepare(opts,env)
  if not prepared then return nil,prepare_error end
  local ok, chan = pcall(vim.fn.jobstart, prepared.cmd, {
    term = true,
    cwd = opts.cwd,
    env = env,
    clear_env = true,
    on_exit = function(id, code)
      -- 자동 종료 요청(M.done)으로 끝난 세션은 창까지 닫아 화면에 남기지 않는다.
      local e = M.entry_by_chan(id)
      if e then require('config.agent.message_transport').stop_server(e.transport) end
      local buf = e and (e.auto_close or e.role == 'plan') and e.buf or nil
      if e and require('config.agent.workspace').active() and not e.auto_close and e.role ~= 'plan' then
        e.exit_code = code
        e.activity_status, e.status_source = code == 0 and 'interrupted' or 'error', 'process-exit'
        if e.status ~= 'complete' and e.status ~= 'review_pending' then e.status = e.activity_status end
        require('config.agent.hub').publish()
        vim.schedule(function() require('config.agent.workspace').refresh() end)
      else
        unregister_by_chan(id)
      end
      if buf then
        vim.schedule(function()
          require('config.agent.workspace').close_session(e)
          if vim.api.nvim_buf_is_valid(buf) then
            pcall(vim.api.nvim_buf_delete, buf, { force = true })
          end
        end)
      end
    end,
  })
  if not ok or type(chan) ~= "number" or chan <= 0 then
    require('config.agent.message_transport').stop_server(prepared.transport)
    return nil, "터미널 생성 실패: " .. tostring(chan)
  end

  next_id = next_id + 1
  local entry = {
    id = next_id,
    name = opts.name or make_name(opts.agent or "agent", opts.branch),
    role = prepared.role or opts.role,
    resume = opts.resume,
    model = prepared.model or opts.model,
    topic = opts.topic,
    agent = opts.agent,
    cwd = opts.cwd,
    branch = opts.branch,
    chan = chan,
    buf = vim.api.nvim_get_current_buf(),
    started_at = vim.loop.now(),
    event_token = event_token,
    event_started = tonumber(env.AGENT_EVENT_STARTED),
    status = 'unknown',
    transport = prepared.transport,
    cli_session = prepared.transport and prepared.transport.expected_cli,
    task_id = env.AGENT_TASK_ID,
    parent_id = tonumber(opts.env and opts.env.AGENT_PARENT_ID),
  }
  M.registry[next_id] = entry
  if opts.saved then require('config.agent.handoff').restore_resume(entry, opts.saved) end
  if entry.transport and entry.transport.vendor=='codex' then vim.schedule(function()require('config.agent.message_transport').activate(entry)end) end

  -- winbar 가 버퍼 변수로 이름을 읽는다(Task 5).
  vim.b[entry.buf].agent_name = entry.name
  vim.bo[entry.buf].bufhidden = 'hide'
  if require('config.agent.workspace').active() then require('config.agent.workspace').select(entry.id, false) end
  return next_id, nil
end

--- 살아있는 터미널 목록. id 순으로 정렬한다.
--- @return table[]
function M.entries()
  local list = {}
  for _, e in pairs(M.registry) do
    if vim.api.nvim_buf_is_valid(e.buf) then
      table.insert(list, e)
    else
      M.registry[e.id] = nil
    end
  end
  table.sort(list, function(a, b)
    return a.id < b.id
  end)
  return list
end

--- UI-only helper. Management readiness never depends on terminal prompt text.
--- @param id integer
--- @param opts { pattern: string, interval_ms?: integer, timeout_ms?: integer, settle_ms?: integer }
--- @param cb fun(ready: boolean)
function M.wait_ready(id, opts, cb)
  local e = M.registry[id]
  if not e then cb(false); return end
  local interval, timeout, settle = opts.interval_ms or 500, opts.timeout_ms or 30000, opts.settle_ms or 1000
  local waited = 0
  local function tick()
    if not vim.api.nvim_buf_is_valid(e.buf) then cb(false); return end
    local n = vim.api.nvim_buf_line_count(e.buf)
    local lines = vim.api.nvim_buf_get_lines(e.buf, math.max(0, n - 40), n, false)
    for _, l in ipairs(lines) do
      if l:find(opts.pattern, 1, true) then
        -- 프롬프트가 보여도 TUI 가 아직 그리는 중일 수 있어 잠시 더 둔다.
        vim.defer_fn(function() cb(true) end, settle)
        return
      end
    end
    waited = waited + interval
    if waited >= timeout then cb(false); return end
    vim.defer_fn(tick, interval)
  end
  tick()
end

-- Management text never touches the terminal composer.
function M.send(id, text, opts)
  local e = M.registry[id]
  if not e then return false, '없는 터미널 id: ' .. tostring(id) end
  if e.exit_code ~= nil then return false, '종료된 터미널입니다' end
  return require('config.agent.message_transport').send(e, text, opts)
end

--- 해당 터미널 창으로 이동한다. 창이 닫혀 있으면 분할해 다시 띄운다.
--- @param id integer
--- @return boolean
function M.focus(id)
  local e = M.registry[id]
  if not e or not vim.api.nvim_buf_is_valid(e.buf) then
    return false
  end
  local W = require('config.agent.workspace')
  if W.active() then W.open(false); return W.select(id, true) end
  for _, w in ipairs(vim.api.nvim_list_wins()) do
    if vim.api.nvim_win_get_buf(w) == e.buf then
      vim.api.nvim_set_current_win(w)
      return true
    end
  end
  if not on_dashboard() then
    vim.cmd("vsplit")
  end
  vim.api.nvim_win_set_buf(0, e.buf)
  return true
end

--- chan 으로 레지스트리 항목을 찾는다.
--- @param chan integer
--- @return table|nil
function M.entry_by_chan(chan)
  for _, e in pairs(M.registry) do
    if e.chan == chan then
      return e
    end
  end
  return nil
end

--- 경로를 비교용으로 정규화한다(구분자 / 통일, 소문자, 끝 / 제거).
--- @param p string
--- @return string
local function norm_path(p)
  p = tostring(p or ""):gsub("\\", "/"):gsub("/+$", "")
  return p:lower()
end

--- 작업이 끝난(커밋·머지된) 세션을 닫는다. 계획 세션이 원격으로 부르거나, 작업 세션의 Stop 훅(agent-done.js)이 부른다:
---   nvim --headless --server "$NVIM" --remote-expr "v:lua.AgentDone({'cwd': '<worktree 경로>'})"
---   nvim --headless --server "$NVIM" --remote-expr "v:lua.AgentDone({'cwd': '<cwd>', 'pids': [<조상 PID 목록>]})"
--- 대상 선택 우선순위: id > pids(터미널 잡 PID 가 호출자의 조상이면 그 세션 — 마커를 찍은 바로 그 세션) > cwd.
--- cwd 는 같은 폴더의 세션이 정확히 하나일 때만 쓴다 — 계획·작업 세션이 같은 폴더면 둘 이상이라
--- 엉뚱한 창(계획 세션)을 닫게 되므로(2026-09-21 사고) 닫지 않고 FAIL 을 돌려준다.
--- 정상 제어 지원이 없으면 실패한다. PTY 명령·강제 종료로 대체하지 않는다.
--- @param o table { id=integer } | { pids=integer[], cwd=string|nil } | { cwd=string }
--- @return string 결과 요약(원격 호출자가 읽는다)
function M.done(o)
  o = o or {}
  local target = nil
  if o.id then
    target = M.registry[o.id]
  end
  if not target and type(o.pids) == "table" and #o.pids > 0 then
    local want = {}
    for _, pid in ipairs(o.pids) do want[tonumber(pid)] = true end
    for _, e in pairs(M.registry) do
      local ok, jp = pcall(vim.fn.jobpid, e.chan)
      if ok and want[jp] then
        target = e
        break
      end
    end
  end
  if not target and o.cwd then
    local want = norm_path(o.cwd)
    local matches = {}
    for _, e in pairs(M.registry) do
      if norm_path(e.cwd) == want then
        matches[#matches + 1] = e
      end
    end
    if #matches > 1 then
      local names = {}
      for _, e in ipairs(matches) do names[#names + 1] = string.format("id=%d %s", e.id, e.name) end
      return "FAIL: 같은 cwd 의 세션이 여럿 — id 로 지정하라: " .. table.concat(names, ", ")
    end
    target = matches[1]
  end
  if not target then
    return "FAIL: 해당 세션 없음 " .. tostring(o.cwd or o.id)
  end
  if not vim.api.nvim_buf_is_valid(target.buf) then
    M.registry[target.id] = nil
    return "FAIL: 버퍼가 이미 닫혔다"
  end

  local ok, err = require('config.agent.message_transport').control(target, 'close')
  if not ok then return 'FAIL: ' .. tostring(err) end
  return 'PENDING: normal close requested; process exit is not yet verified'
end

-- 원격에서 v:lua.AgentDone(...) 로 부를 수 있게 전역에 노출한다.
_G.AgentDone = M.done

--- 버퍼에 붙은 에이전트 이름. winbar(Task 5)가 쓴다.
--- @param buf integer
--- @return string|nil
function M.name_of(buf)
  for _, e in pairs(M.registry) do
    if e.buf == buf then
      return e.name
    end
  end
  return nil
end

return M
