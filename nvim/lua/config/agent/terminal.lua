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
  if on_dashboard() then
    vim.cmd("enew")
  else
    vim.cmd((opts.split or "vsplit") .. " | enew")
  end

  local ok, chan = pcall(vim.fn.jobstart, opts.cmd, {
    term = true,
    cwd = opts.cwd,
    env = opts.env,
    on_exit = function(id)
      -- 자동 종료 요청(M.done)으로 끝난 세션은 창까지 닫아 화면에 남기지 않는다.
      local e = M.entry_by_chan(id)
      local buf = e and e.auto_close and e.buf or nil
      unregister_by_chan(id)
      if buf then
        vim.schedule(function()
          if vim.api.nvim_buf_is_valid(buf) then
            pcall(vim.api.nvim_buf_delete, buf, { force = true })
          end
        end)
      end
    end,
  })
  if not ok or type(chan) ~= "number" or chan <= 0 then
    return nil, "터미널 생성 실패: " .. tostring(chan)
  end

  next_id = next_id + 1
  local entry = {
    id = next_id,
    name = make_name(opts.agent or "agent", opts.branch),
    agent = opts.agent,
    cwd = opts.cwd,
    branch = opts.branch,
    chan = chan,
    buf = vim.api.nvim_get_current_buf(),
    started_at = vim.loop.now(),
  }
  M.registry[next_id] = entry

  -- winbar 가 버퍼 변수로 이름을 읽는다(Task 5).
  vim.b[entry.buf].agent_name = entry.name
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

--- 터미널 버퍼에 프롬프트가 나타날 때까지 기다린다(에이전트 CLI 기동 대기).
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

--- 입력창에 본문이 남아 있는지(미제출) 검사한다.
--- @param buf integer
--- @param head string
--- @param prompt string
--- @return boolean
local function still_pending(buf, head, prompt)
  if not vim.api.nvim_buf_is_valid(buf) then return false end
  local n = vim.api.nvim_buf_line_count(buf)
  local lines = vim.api.nvim_buf_get_lines(buf, math.max(0, n - 40), n, false)
  local seen_prompt = false
  for _, l in ipairs(lines) do
    if l:find(prompt, 1, true) then seen_prompt = true end
    if seen_prompt and l:find(head, 1, true) then return true end
  end
  return false
end

--- 터미널에 문자열을 주입하고 잠시 뒤 Enter 로 제출한다.
--- 본문과 Enter 를 한 번에 보내면 긴 본문이 붙여넣기로 인식돼 "\r" 이 줄바꿈이 된다.
--- Enter 를 보내도 제출되지 않는 경우가 있어(2026-10-01 핸드오프 id=3 관찰),
--- 제출 확인 후 미제출이면 재시도한다(최대 max_tries 회, 1초 간격, 홀수 회 "\r"/짝수 회 "\n").
--- @param id integer
--- @param text string
--- @param opts { enter_delay_ms?: integer, prompt?: string, max_tries?: integer }|nil
--- @return boolean ok, string|nil err
function M.send(id, text, opts)
  local e = M.registry[id]
  if not e then
    return false, "없는 터미널 id: " .. tostring(id)
  end
  local ok, err = pcall(vim.fn.chansend, e.chan, text)
  if not ok then
    return false, tostring(err)
  end
  local chan, buf = e.chan, e.buf
  local prompt = (opts and opts.prompt) or "❯"
  local head = text:sub(1, 20)
  local tries, max_tries = 0, (opts and opts.max_tries) or 5
  local function submit()
    tries = tries + 1
    pcall(vim.fn.chansend, chan, (tries % 2 == 1) and "\r" or "\n")
    vim.defer_fn(function()
      if not still_pending(buf, head, prompt) then return end
      if tries >= max_tries then
        vim.notify(string.format("터미널 id=%d: 브리핑이 입력창에 남아 있습니다. Enter 를 눌러 주세요.", id), vim.log.levels.WARN)
        return
      end
      submit()
    end, 1000)
  end
  vim.defer_fn(submit, (opts and opts.enter_delay_ms) or 1000)
  return true, nil
end

--- 해당 터미널 창으로 이동한다. 창이 닫혀 있으면 분할해 다시 띄운다.
--- @param id integer
--- @return boolean
function M.focus(id)
  local e = M.registry[id]
  if not e or not vim.api.nvim_buf_is_valid(e.buf) then
    return false
  end
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
--- 해당 터미널에 종료 명령(/exit · /quit)을 보내고, 프로세스가 끝나면
--- on_exit 가 창과 버퍼를 지운다. 10초 안에 안 끝나면 잡을 강제 종료한다.
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

  target.auto_close = true
  local quit = target.agent == "Codex" and "/quit" or "/exit"
  local ok, err = M.send(target.id, quit)
  if not ok then
    return "FAIL: " .. tostring(err)
  end
  -- 종료 명령이 먹지 않으면 강제 종료. on_exit 가 창 정리를 이어받는다.
  local chan, buf = target.chan, target.buf
  vim.defer_fn(function()
    if M.entry_by_chan(chan) then
      pcall(vim.fn.jobstop, chan)
    end
  end, 10000)
  -- on_exit 를 못 타는 경우(핫패치 전에 띄운 세션 등)를 위한 안전망: 잡이 끝났는지 폴링해 버퍼를 지운다.
  local timer = vim.uv.new_timer()
  timer:start(1000, 1000, vim.schedule_wrap(function()
    local alive = vim.fn.jobwait({ chan }, 0)[1] == -1
    if alive then
      return
    end
    timer:stop()
    timer:close()
    if vim.api.nvim_buf_is_valid(buf) then
      pcall(vim.api.nvim_buf_delete, buf, { force = true })
    end
    M.registry[target.id] = nil
  end))
  return string.format("OK closing id=%d %s", target.id, target.name)
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
