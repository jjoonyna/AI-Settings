-- 에이전트 실행 3단계 메뉴: 에이전트 → 세션 종류 → (작업이면) worktree
--
-- 설계 §4-2-6-1:
--   계획 세션은 파일을 쓰지 않으므로 worktree 를 묻지 않고 즉시 실행한다.
--   작업 세션만 격리 여부를 묻는다.

local worktree = require("config.agent.worktree")
local terminal = require("config.agent.terminal")

local M = {}

--- 에이전트 정의. 세션 종류별 실행 명령을 담는다.
--- Codex 프로필은 ~/.codex/CODEX-사용안내.md 기준(plan / work).
M.AGENTS = {
  {
    key = "claude",
    label = "Claude Code",
    short = "Claude",
    plan = { "claude", "--model", "fable" },
    work = { "claude", "--model", "opus" },
  },
  {
    key = "codex",
    label = "Codex",
    short = "Codex",
    plan = { "codex", "--profile", "plan" },
    work = { "codex", "--profile", "work" },
  },
}

--- @param agent_key string "claude" | "codex"
--- @param session string "plan" | "work"
--- @return string[]|nil
function M.cmd_for(agent_key, session)
  for _, a in ipairs(M.AGENTS) do
    if a.key == agent_key then
      return a[session]
    end
  end
  return nil
end

--- @param agent table
--- @param session string
--- @param cwd string
--- @param branch string|nil
local function launch(agent, session, cwd, branch)
  local cmd = agent[session]
  if not cmd then
    vim.notify("알 수 없는 세션 종류: " .. tostring(session), vim.log.levels.ERROR)
    return
  end
  if vim.fn.executable(cmd[1]) ~= 1 then
    vim.notify(cmd[1] .. " 를 PATH 에서 찾을 수 없습니다", vim.log.levels.ERROR)
    return
  end
  local id, err = terminal.spawn({
    agent = agent.short,
    cmd = cmd,
    cwd = cwd,
    branch = branch,
    env = { AGENT_SESSION_ROLE = session }, -- Stop 훅은 work 세션만 닫는다
  })
  if not id then
    vim.notify("터미널 생성 실패: " .. tostring(err), vim.log.levels.ERROR)
    return
  end
  vim.notify(string.format("%s (%s) 시작 — %s", agent.label, session, cwd))
end

--- 현재 브랜치 이름. 실패하면 nil.
--- @return string|nil
local function current_branch()
  local out = vim.fn.systemlist({ "git", "branch", "--show-current" })
  if vim.v.shell_error ~= 0 or not out[1] or out[1] == "" then
    return nil
  end
  return out[1]
end

--- 3단계: 기존 worktree 목록에서 고르기
--- @param agent table
local function step_pick_existing(agent)
  local list = worktree.list()
  if #list == 0 then
    vim.notify("worktree 가 없습니다", vim.log.levels.WARN)
    return
  end
  local labels = {}
  for _, w in ipairs(list) do
    -- -a 계열은 본선과 성격이 달라 경고를 붙인다(설계 하드 가드).
    labels[#labels + 1] = string.format("%s  [%s]%s", w.path, w.branch, w.is_a and "  ⚠ -a 계열" or "")
  end
  vim.ui.select(labels, { prompt = "worktree 선택" }, function(_, idx)
    if not idx then
      return
    end
    local w = list[idx]
    if w.is_a then
      vim.notify("-a 계열 worktree 입니다. 본선 작업과 섞지 않도록 주의하세요: " .. w.branch, vim.log.levels.WARN)
    end
    launch(agent, "work", w.path, w.branch)
  end)
end

--- 3단계: 새 worktree 만들기. git 변경이므로 실행 전 확인을 받는다.
--- @param agent table
local function step_create_new(agent)
  vim.ui.input({ prompt = "새 브랜치명 (예: hotfix/v2.4.6): " }, function(branch)
    if not branch or branch == "" then
      return
    end
    local path = worktree.suggest(branch)
    local exists = worktree.branch_exists(branch)
    local msg = string.format(
      "worktree 를 만듭니다.  브랜치: %s (%s)  경로: %s  — 진행할까요?",
      branch,
      exists and "기존 브랜치 사용" or "새로 생성",
      path
    )
    -- git 변경 작업이므로 반드시 확인을 받는다(Global Constraints).
    vim.ui.select({ "예, 만듭니다", "아니요" }, { prompt = msg }, function(_, idx)
      if idx ~= 1 then
        vim.notify("취소했습니다")
        return
      end
      local created, err = worktree.create(branch, path, not exists)
      if not created then
        vim.notify("worktree 생성 실패:\n" .. tostring(err), vim.log.levels.ERROR)
        return
      end
      vim.notify("worktree 생성: " .. created)
      launch(agent, "work", created, branch)
    end)
  end)
end

--- 3단계: 작업 세션의 worktree 선택
--- @param agent table
local function step_worktree(agent)
  -- git 저장소가 아니면(C:\DocsBackup 등) 격리 개념이 없다. 즉시 실행한다.
  if not worktree.is_git_repo() then
    launch(agent, "work", vim.fn.getcwd(), nil)
    return
  end
  local choices = {
    "현재 폴더 그대로 (격리 없음)",
    "새 worktree 생성",
    "기존 worktree 선택",
  }
  vim.ui.select(choices, { prompt = "작업 위치" }, function(_, idx)
    if idx == 1 then
      launch(agent, "work", vim.fn.getcwd(), current_branch())
    elseif idx == 2 then
      step_create_new(agent)
    elseif idx == 3 then
      step_pick_existing(agent)
    end
  end)
end

--- 2단계: 세션 종류
--- @param agent table
local function step_session(agent)
  vim.ui.select(
    { "계획 세션 (worktree 묻지 않음)", "작업 세션" },
    { prompt = agent.label .. " — 세션 종류" },
    function(_, idx)
      if idx == 1 then
        -- 계획은 파일을 쓰지 않으므로 현재 폴더에서 바로 띄운다.
        launch(agent, "plan", vim.fn.getcwd(), current_branch())
      elseif idx == 2 then
        step_worktree(agent)
      end
    end
  )
end

--- 1단계: 에이전트 선택
function M.open()
  local labels = {}
  for _, a in ipairs(M.AGENTS) do
    labels[#labels + 1] = a.label
  end
  vim.ui.select(labels, { prompt = "에이전트" }, function(_, idx)
    if not idx then
      return
    end
    step_session(M.AGENTS[idx])
  end)
end

return M
