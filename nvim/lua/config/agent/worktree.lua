-- git worktree 조회와 생성.
-- 조회는 자유롭게 하지만 생성은 git 변경 작업이므로
-- 호출하는 쪽(menu.lua)이 반드시 사용자 확인을 받은 뒤에 부른다.

local M = {}

--- 현재 작업 디렉터리가 git 저장소 안인지 판정한다.
--- @return boolean
function M.is_git_repo()
  local out = vim.fn.systemlist({ "git", "rev-parse", "--is-inside-work-tree" })
  return vim.v.shell_error == 0 and out[1] == "true"
end

--- worktree 목록을 파싱한다.
--- `git worktree list --porcelain` 은 레코드를 빈 줄로 구분하고
--- 각 줄이 "worktree <경로>" / "HEAD <sha>" / "branch refs/heads/<이름>" 형태다.
--- detached HEAD 인 worktree 는 branch 줄이 없다.
--- @return table[] { path, branch, head, is_a }
function M.list()
  if not M.is_git_repo() then
    return {}
  end
  local lines = vim.fn.systemlist({ "git", "worktree", "list", "--porcelain" })
  if vim.v.shell_error ~= 0 then
    return {}
  end

  local result = {}
  local cur = nil
  for _, line in ipairs(lines) do
    local path = line:match("^worktree (.+)$")
    local head = line:match("^HEAD (.+)$")
    local branch = line:match("^branch refs/heads/(.+)$")
    if path then
      cur = { path = path, branch = "(detached)", head = "", is_a = false }
      table.insert(result, cur)
    elseif cur and head then
      cur.head = head:sub(1, 7)
    elseif cur and branch then
      cur.branch = branch
      -- -a 계열(hotfix/v2.1.0-a)은 본선과 성격이 다르다. 설계의 하드 가드 대상.
      cur.is_a = branch:match("%-a$") ~= nil
    end
  end
  return result
end

--- 본체 worktree 경로. porcelain 출력의 첫 레코드가 본체다.
--- @return string
function M.main_path()
  local list = M.list()
  return list[1] and list[1].path or vim.fn.getcwd()
end

--- 로컬 브랜치가 이미 있는지.
--- @param branch string
--- @return boolean
function M.branch_exists(branch)
  vim.fn.system({ "git", "rev-parse", "--verify", "--quiet", "refs/heads/" .. branch })
  return vim.v.shell_error == 0
end

--- 새 worktree 폴더 경로를 제안한다.
--- hotfix/v<버전> → <본체 부모>/<본체 이름>-hotfix-<버전>   (예: D:/src/app → D:/src/app-hotfix-2.4.5)
--- 그 밖           → <본체>/worktrees/<브랜치 마지막 토큰>   (머지 후 자동 삭제 대상 — 전역 CLAUDE.md §10)
--- @param branch string
--- @param main string|nil  테스트용. nil 이면 M.main_path()
--- @return string
function M.suggest(branch, main)
  main = (main or M.main_path()):gsub("\\", "/"):gsub("/$", "")
  local parent = vim.fn.fnamemodify(main, ":h")
  local name = vim.fn.fnamemodify(main, ":t")
  local ver = branch:match("^hotfix/v(.+)$")
  if ver then
    return parent .. "/" .. name .. "-hotfix-" .. ver
  end
  return main .. "/worktrees/" .. (branch:gsub("^[^/]+/", ""))
end

--- worktree 를 만든다.
--- 반드시 사용자 확인을 받은 뒤에만 호출한다(Global Constraints).
--- @param branch string
--- @param path string
--- @param new_branch boolean 브랜치를 새로 만들지 여부
--- @return string|nil path, string|nil err
function M.create(branch, path, new_branch)
  local cmd = new_branch and { "git", "worktree", "add", "-b", branch, path }
    or { "git", "worktree", "add", path, branch }
  local out = vim.fn.systemlist(cmd)
  if vim.v.shell_error ~= 0 then
    return nil, table.concat(out, "\n")
  end
  return path, nil
end

return M
