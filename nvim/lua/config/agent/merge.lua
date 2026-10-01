-- :AgentMerge 1단계 — 머지 브리핑 생성.
--
-- 설계 §4-2-6-5 의 5단계 중 nvim 이 맡는 것은 1단계뿐이다.
-- 2단계(전략 판단)부터는 에이전트가 하므로, 브리핑을 만들어 터미널에 주입한다.
--
-- 중요: 이 모듈은 git 을 읽기만 한다. 실제 머지는 절대 실행하지 않는다.
--       충돌 예상은 `git merge-tree --write-tree` 로 본다 —
--       작업 트리와 인덱스를 건드리지 않고 머지 결과만 계산하는 명령이다.

local worktree = require("config.agent.worktree")
local terminal = require("config.agent.terminal")

local M = {}

--- 현재 브랜치.
--- @return string|nil
local function current_branch()
  local out = vim.fn.systemlist({ "git", "branch", "--show-current" })
  if vim.v.shell_error ~= 0 or not out[1] or out[1] == "" then
    return nil
  end
  return out[1]
end

--- 머지 대상 후보. 하드 가드: -a 계열과 현재 브랜치는 뺀다.
--- @return table[] ok, table[] excluded
function M.candidates()
  local cur = current_branch()
  local ok, excluded = {}, {}
  for _, w in ipairs(worktree.list()) do
    if w.is_a then
      -- 설계 하드 가드: -a 계열(hotfix/v*-a)은 경고하고 제외한다.
      table.insert(excluded, w)
    elseif w.branch ~= cur and w.branch ~= "(detached)" then
      table.insert(ok, w)
    end
  end
  return ok, excluded
end

--- 브리핑 자료를 모은다. git 을 읽기만 한다.
--- @param target string 받는 쪽 브랜치
--- @param source string 주는 쪽 브랜치
--- @return table
function M.collect(target, source)
  local d = { target = target, source = source }

  local base = vim.fn.systemlist({ "git", "merge-base", target, source })
  d.base = (vim.v.shell_error == 0 and base[1]) and base[1] or nil

  local function changed(from, to)
    if not from then
      return {}
    end
    local out = vim.fn.systemlist({ "git", "diff", "--name-only", from, to })
    return vim.v.shell_error == 0 and out or {}
  end

  d.target_files = changed(d.base, target)
  d.source_files = changed(d.base, source)

  -- 양쪽이 공통으로 건드린 파일 — 충돌 후보
  local in_target = {}
  for _, f in ipairs(d.target_files) do
    in_target[f] = true
  end
  d.both = {}
  for _, f in ipairs(d.source_files) do
    if in_target[f] then
      table.insert(d.both, f)
    end
  end

  -- 실제 충돌 예상: merge-tree 는 작업 트리를 건드리지 않는다.
  -- 첫 줄은 트리 OID, 그 뒤가 충돌 파일 목록이다.
  local mt = vim.fn.systemlist({ "git", "merge-tree", "--write-tree", "--name-only", target, source })
  d.conflict = vim.v.shell_error ~= 0
  d.conflict_files = {}
  for i, line in ipairs(mt) do
    if i > 1 and line ~= "" then
      table.insert(d.conflict_files, line)
    end
  end

  -- 커밋 수
  local function count(range)
    local out = vim.fn.systemlist({ "git", "rev-list", "--count", range })
    return (vim.v.shell_error == 0 and out[1]) and out[1] or "?"
  end
  d.ahead = count(target .. ".." .. source)
  d.behind = count(source .. ".." .. target)

  return d
end

--- 브리핑을 마크다운으로 만든다.
--- @param d table
--- @return string[]
function M.render(d)
  local L = {}
  local function add(s)
    L[#L + 1] = s
  end

  add("# 머지 브리핑 (`:AgentMerge` 1단계)")
  add("")
  add("생성: " .. os.date("%Y-%m-%d %H:%M:%S"))
  add("")
  add("## 대상")
  add("")
  add("| | 브랜치 |")
  add("|---|---|")
  add("| 받는 쪽 (target) | `" .. d.target .. "` |")
  add("| 주는 쪽 (source) | `" .. d.source .. "` |")
  add("")
  add("- merge-base: `" .. (d.base and d.base:sub(1, 7) or "없음") .. "`")
  add("- source 가 앞선 커밋: " .. d.ahead .. " / target 이 앞선 커밋: " .. d.behind)
  add("")
  add("## 변경 규모")
  add("")
  add("- target 이 base 이후 바꾼 파일: " .. #d.target_files .. "개")
  add("- source 가 base 이후 바꾼 파일: " .. #d.source_files .. "개")
  add("- **양쪽이 공통으로 건드린 파일: " .. #d.both .. "개**")
  add("")
  add("## 충돌 예상 (`git merge-tree --write-tree`)")
  add("")
  if not d.conflict then
    add("**충돌 없음.** 자동 머지가 가능한 상태다.")
  else
    add("**충돌 " .. #d.conflict_files .. "개 파일.** 아래 파일은 사람이(=2단계 planner 가) 판단해야 한다.")
    add("")
    for _, f in ipairs(d.conflict_files) do
      add("- `" .. f .. "`")
    end
  end
  add("")
  add("## 2단계에서 판단할 것")
  add("")
  add("충돌 파일마다 **두 기능이 모두 살아나려면 어떻게 통합해야 하는가**를 정한다.")
  add("한쪽을 버리는 선택을 했다면 그 이유를 남긴다.")
  add("")
  return L
end

--- 브리핑을 파일로 쓴다. rbm 저장소가 아니라 nvim state 에 둔다.
--- @param lines string[]
--- @return string path
function M.write(lines)
  local dir = vim.fn.stdpath("state") .. "/agent-merge"
  vim.fn.mkdir(dir, "p")
  local path = dir .. "/" .. os.date("%Y%m%d-%H%M%S") .. ".md"
  vim.fn.writefile(lines, path)
  return path
end

--- 에이전트에 보낼 지시문.
--- @param path string 브리핑 경로
--- @param d table
--- @return string
local function build_prompt(path, d)
  return table.concat({
    "머지 브리핑 " .. path .. " 를 읽고 `:AgentMerge` 2단계를 해줘.",
    string.format("(%s ← %s, 충돌 %s)", d.target, d.source, d.conflict and (#d.conflict_files .. "개") or "없음"),
    "2단계는 전략 판단까지만이다. 실제 머지는 하지 마.",
  }, " ")
end

--- 전체 흐름: 대상 선택 → 브리핑 생성 → 에이전트 주입
function M.open()
  if not worktree.is_git_repo() then
    vim.notify("git 저장소가 아닙니다", vim.log.levels.ERROR)
    return
  end
  local target = current_branch()
  if not target then
    vim.notify("현재 브랜치를 알 수 없습니다(detached HEAD?)", vim.log.levels.ERROR)
    return
  end

  local cands, excluded = M.candidates()
  if #excluded > 0 then
    local names = {}
    for _, w in ipairs(excluded) do
      names[#names + 1] = w.branch
    end
    -- 설계 하드 가드: -a 계열은 경고하고 제외한다.
    vim.notify(
      "-a 계열은 머지 대상에서 제외했습니다: "
        .. table.concat(names, ", ")
        .. "\n본선과 섞으면 납품 커스텀이 본선에 들어갑니다.",
      vim.log.levels.WARN
    )
  end
  if #cands == 0 then
    vim.notify("머지할 수 있는 다른 worktree 가 없습니다", vim.log.levels.WARN)
    return
  end

  local labels = {}
  for _, w in ipairs(cands) do
    labels[#labels + 1] = string.format("%s  [%s]", w.branch, w.path)
  end
  vim.ui.select(labels, { prompt = target .. " ← 어느 브랜치를 합칠까요" }, function(_, idx)
    if not idx then
      return
    end
    local source = cands[idx].branch
    vim.notify("브리핑 생성 중… (" .. target .. " ← " .. source .. ")")

    local d = M.collect(target, source)
    local path = M.write(M.render(d))

    -- 브리핑을 열어 사용자도 바로 볼 수 있게 한다.
    vim.cmd("vsplit " .. vim.fn.fnameescape(path))

    local entries = terminal.entries()
    if #entries == 0 then
      vim.notify(
        "브리핑: " .. path .. "\n에이전트 터미널이 없어 주입하지 않았습니다. <leader>aa 로 세션을 띄운 뒤 <leader>as 로 보내세요.",
        vim.log.levels.WARN
      )
      return
    end
    local tlabels = {}
    for _, e in ipairs(entries) do
      tlabels[#tlabels + 1] = e.name .. "  " .. e.cwd
    end
    vim.ui.select(tlabels, { prompt = "2단계를 맡길 세션" }, function(_, ti)
      if not ti then
        vim.notify("브리핑만 만들었습니다: " .. path)
        return
      end
      terminal.send(entries[ti].id, build_prompt(path, d))
      vim.notify(entries[ti].name .. " 에 2단계를 요청했습니다")
    end)
  end)
end

return M
