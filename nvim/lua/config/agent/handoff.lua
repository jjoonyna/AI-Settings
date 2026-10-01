-- 계획 세션이 작업 세션을 띄우는 핸드오프의 수신부.
--
-- 계획 세션(nvim 터미널의 자식 프로세스)은 $NVIM 으로 부모 nvim 의
-- 파이프 주소를 받는다. 그 주소로 --remote-expr 를 쏘면 이 함수가 실행된다.
--
--   nvim --headless --server "$NVIM" --remote-expr "v:lua.AgentHandoff({...})"
--
-- 주의: 호출하는 쪽도 --headless 를 붙여야 한다. 없으면 nvim 이 UI 를
--       띄우려 해서 터미널 제어 시퀀스가 반환값을 오염시킨다.

local menu = require("config.agent.menu")
local terminal = require("config.agent.terminal")

local M = {}

--- 작업 세션에 넘길 지시문을 조립한다.
--- 설계 §4-2-6-4 가 넘기라고 명시한 4가지를 모두 담는다.
--- @param o table
--- @return string
local function build_prompt(o)
  local lines = {}
  lines[#lines + 1] = string.format("계획 문서 %s 를 읽고 실행해줘.", o.plan_doc or "(경로 없음)")
  if o.worktree and o.worktree ~= "" then
    lines[#lines + 1] = string.format("작업 위치: %s", o.worktree)
  end
  if o.strategy and o.strategy ~= "" then
    lines[#lines + 1] = string.format("작업 분할 전략: %s", o.strategy)
  end
  -- 규칙 요약은 설계가 반드시 넘기라고 지정한 항목이다.
  lines[#lines + 1] = o.rules
    or "계획을 벗어난 판단이 필요하면 멈추고 보고해. 커밋·머지는 실행도 언급도 하지 마. push 금지."
  return table.concat(lines, " ")
end

--- 원격에서 호출되는 진입점.
--- @param o table { agent?, session?, plan_doc?, worktree?, branch?, strategy?, rules? }
--- branch 를 주지 않으면 worktree 경로에서 git 으로 알아낸다.
--- @return string 결과 요약(원격 호출자가 읽는다)
function M.receive(o)
  o = o or {}
  local agent_key = o.agent or "claude"
  local session = o.session or "work"

  local cmd = menu.cmd_for(agent_key, session)
  if not cmd then
    return "FAIL: 알 수 없는 에이전트/세션 " .. agent_key .. "/" .. session
  end
  if vim.fn.executable(cmd[1]) ~= 1 then
    return "FAIL: PATH 에 " .. cmd[1] .. " 없음"
  end

  local cwd = o.worktree
  if not cwd or cwd == "" or vim.fn.isdirectory(cwd) == 0 then
    cwd = vim.fn.getcwd()
  end

  local branch = o.branch
  if not branch then
    local out = vim.fn.systemlist({ "git", "-C", cwd, "branch", "--show-current" })
    branch = (vim.v.shell_error == 0 and out[1] ~= "") and out[1] or nil
  end

  local short = agent_key == "codex" and "Codex" or "Claude"
  -- AGENT_SESSION_ROLE: Stop 훅이 완료 마커로 닫을 수 있는 세션은 work 만(계획 세션 오폐쇄 방지)
  local id, err = terminal.spawn({ agent = short, cmd = cmd, cwd = cwd, branch = branch,
    env = { AGENT_SESSION_ROLE = session } })
  if not id then
    return "FAIL: 터미널 생성 실패 " .. tostring(err)
  end

  -- 에이전트 CLI 가 뜨기까지 시간이 걸린다. 프롬프트가 보일 때까지 기다렸다가 보낸다(최대 30초).
  local prompt = build_prompt(o)
  local pattern = agent_key == "codex" and "›" or "❯"
  terminal.wait_ready(id, { pattern = pattern }, function(ready)
    if not ready then
      vim.notify(string.format("핸드오프 id=%d: 30초 안에 프롬프트가 뜨지 않아 브리핑을 보내지 못했습니다. 직접 붙여넣으세요.", id), vim.log.levels.ERROR)
      return
    end
    local ok, err = terminal.send(id, prompt, { prompt = pattern })
    if not ok then
      vim.notify(string.format("핸드오프 id=%d: 브리핑 전송 실패 — %s", id, tostring(err)), vim.log.levels.ERROR)
    end
  end)

  return string.format("OK id=%d cwd=%s branch=%s", id, cwd, tostring(branch))
end

-- 원격에서 v:lua.AgentHandoff(...) 로 부를 수 있게 전역에 노출한다.
_G.AgentHandoff = M.receive

return M
