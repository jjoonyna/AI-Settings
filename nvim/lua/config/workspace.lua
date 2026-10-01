-- 열린 경로에 따라 작업 환경을 자동 적용한다.
-- 시스템 환경변수는 절대 건드리지 않는다 — 이 nvim 프로세스 안에서만 유효하다.

local M = {}

local local_cfg = require("config.local_loader").get()

local function norm(p) return (p:gsub("\\", "/"):lower()) end

--- 경로가 어느 프로파일에 속하는지 판정한다. root 와 "root-*"(hotfix worktree) 를 모두 그 프로파일로 본다.
--- @param cwd string|nil  nil 이면 vim.fn.getcwd()
--- @return string|nil
function M.detect_profile(cwd)
  local c = norm(cwd or vim.fn.getcwd())
  for name, p in pairs(local_cfg.projects) do
    if p.root then
      local r = norm(p.root)
      if c == r or c:sub(1, #r + 1) == r .. "/" or c:sub(1, #r + 1) == r .. "-" then
        return name
      end
    end
  end
  return nil
end

--- rbm 프로파일: JDK 21 을 이 프로세스에만 적용한다.
local function apply_rbm()
  local JDK21 = local_cfg.jdk21
  if not JDK21 or vim.fn.isdirectory(JDK21) == 0 then
    vim.notify("JDK 21 을 찾을 수 없습니다: " .. tostring(JDK21), vim.log.levels.WARN)
    return
  end
  vim.env.JAVA_HOME = JDK21
  -- gradlew 가 JAVA_HOME/bin/java 를 쓰므로 PATH 도 앞에 붙인다.
  vim.env.PATH = JDK21 .. "/bin;" .. vim.env.PATH
end

--- docs 프로파일: 문서 작성에 맞춘 설정.
local function apply_docs()
  vim.api.nvim_create_autocmd("FileType", {
    group = vim.api.nvim_create_augroup("docs_profile", { clear = true }),
    pattern = { "markdown", "text" },
    callback = function()
      vim.opt_local.wrap = true
      vim.opt_local.linebreak = true      -- 단어 단위로 줄바꿈
      vim.opt_local.breakindent = true    -- 줄바꿈 시 들여쓰기 유지
      vim.opt_local.spell = false         -- 한글 문서라 영어 맞춤법은 끈다
      vim.opt_local.conceallevel = 2
    end,
    desc = "문서 작성 모드",
  })
end

function M.setup()
  local profile = M.detect_profile()
  vim.g.workspace_profile = profile

  if profile == "rbm" then
    apply_rbm()
  elseif profile == "docs" then
    apply_docs()
  end
end

--- 현재 프로파일을 사람이 읽을 형태로 반환한다(진단용).
function M.status()
  return {
    profile = vim.g.workspace_profile or "(없음)",
    cwd = vim.fn.getcwd(),
    java_home = vim.env.JAVA_HOME or "(미설정)",
  }
end

return M
