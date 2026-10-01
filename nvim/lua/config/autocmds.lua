-- LazyVim 기본 autocmd 위에 개인 설정을 얹는다.

-- ── 창 크기 균등화 (설계 §4-2-9 ①) ────────────────────
-- 터미널 크기가 바뀌어도 vsplit 균등 폭을 되찾는다.
-- 사이드바(neo-tree 등)는 winfixwidth 로 제외되므로 폭이 유지된다.
vim.api.nvim_create_autocmd("VimResized", {
  group = vim.api.nvim_create_augroup("equalize_windows", { clear = true }),
  callback = function()
    local cur = vim.api.nvim_get_current_win()
    vim.cmd("wincmd =")
    vim.api.nvim_set_current_win(cur)
  end,
  desc = "터미널 크기 변경 시 창 폭 재균등화",
})

-- 사이드바·터미널 창은 균등화 대상에서 뺀다.
vim.api.nvim_create_autocmd("FileType", {
  group = vim.api.nvim_create_augroup("fix_sidebar_width", { clear = true }),
  pattern = { "neo-tree", "NvimTree", "aerial", "Outline", "snacks_layout_box" },
  callback = function()
    vim.opt_local.winfixwidth = true
  end,
  desc = "파일트리 폭 고정 — wincmd = 로부터 보호",
})

-- ── winbar: 창마다 파일명 표시 (설계 §4-2-9 ②) ────────
-- 계획 B-2 에서 에이전트 터미널 이름·worktree 를 여기에 덧붙인다.
local function winbar_text()
  local buf = vim.api.nvim_get_current_buf()
  local bt = vim.bo[buf].buftype
  if bt == "terminal" then
    -- 에이전트 허브(B-2)가 붙인 이름을 우선 쓴다.
    -- 이름이 없으면 B-1 과 동일하게 term_title 로 떨어진다.
    local agent_name = vim.b[buf].agent_name
    if not agent_name then
      local ok, T = pcall(require, "config.agent.terminal")
      if ok then
        agent_name = T.name_of(buf)
      end
    end
    return "  " .. ((agent_name or vim.b[buf].term_title or "terminal"):gsub("%%", "%%%%"))
  end
  local name = vim.fn.expand("%:t")
  if name == "" then
    return "  [No Name]"
  end
  local modified = vim.bo[buf].modified and " ●" or ""
  return "  " .. name .. modified
end

_G.__winbar = winbar_text

vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost", "TermOpen" }, {
  group = vim.api.nvim_create_augroup("winbar_label", { clear = true }),
  callback = function()
    local bt = vim.bo.buftype
    local ft = vim.bo.filetype
    -- 사이드바·팝업에는 붙이지 않는다.
    if ft == "neo-tree" or ft == "snacks_picker_list" or bt == "nofile" or bt == "prompt" then
      vim.opt_local.winbar = nil
      return
    end
    vim.opt_local.winbar = "%{%v:lua.__winbar()%}"
  end,
  desc = "창 상단에 파일명 표시",
})

-- ── 비활성 창 흐리게 ──────────────────────────────────
vim.api.nvim_create_autocmd({ "WinEnter", "BufWinEnter" }, {
  group = vim.api.nvim_create_augroup("dim_inactive", { clear = true }),
  callback = function()
    vim.opt_local.cursorline = true
  end,
})
vim.api.nvim_create_autocmd("WinLeave", {
  group = "dim_inactive",
  callback = function()
    vim.opt_local.cursorline = false
  end,
})

-- ── 파일타입별 인덴트 (설계 §4-2-3) ───────────────────
-- Java 는 4칸, 프론트엔드 계열은 2칸이 프로젝트 관례다.
vim.api.nvim_create_autocmd("FileType", {
  group = vim.api.nvim_create_augroup("indent_by_filetype", { clear = true }),
  pattern = { "java" },
  callback = function()
    vim.opt_local.shiftwidth = 4
    vim.opt_local.tabstop = 4
    vim.opt_local.softtabstop = 4
  end,
  desc = "Java 는 4칸 인덴트",
})

vim.api.nvim_create_autocmd("FileType", {
  group = "indent_by_filetype",
  pattern = { "javascript", "typescript", "typescriptreact", "css", "html", "json", "jsonc", "yaml" },
  callback = function()
    vim.opt_local.shiftwidth = 2
    vim.opt_local.tabstop = 2
    vim.opt_local.softtabstop = 2
  end,
  desc = "프론트엔드 계열은 2칸 인덴트",
})

-- ── 바이너리 오피스 파일을 열면 경고하고 외부로 넘긴다 ──
vim.api.nvim_create_autocmd("BufReadPre", {
  group = vim.api.nvim_create_augroup("office_files", { clear = true }),
  pattern = { "*.xlsx", "*.xls", "*.pptx", "*.ppt", "*.docx", "*.doc", "*.pdf", "*.hwp", "*.hwpx" },
  callback = function(ev)
    vim.schedule(function()
      vim.fn.jobstart({ "cmd.exe", "/c", "start", "", ev.match }, { detach = true })
      vim.notify("기본 프로그램으로 열었습니다 (nvim 에서는 편집하지 않습니다)", vim.log.levels.INFO)
      -- 깨진 바이너리 버퍼를 남기지 않는다.
      pcall(vim.api.nvim_buf_delete, ev.buf, { force = true })
    end)
  end,
  desc = "오피스 파일은 기본 프로그램으로",
})

-- ── 폴더별 환경 프로파일 (Task 9) ─────────────────────
require("config.workspace").setup()

-- ── 시작 시 파일트리 자동 표시 (설계 §4-2-2) ──────────
-- LazyVim 기본은 대시보드가 먼저 뜬다. 트리를 대신 띄운다.
local function open_filetree()
  -- 파이프로 내용을 받아 연 경우(`cat x | nvim -`)는 방해하지 않는다.
  if vim.fn.argv(0) == "-" then
    return
  end
  -- 그 외에는 항상 트리를 띄운다.
  -- 파일을 지정해 열었어도(`nvim foo.js`) 트리가 보이는 것이 요구사항이다.
  vim.schedule(function()
    pcall(vim.cmd, "Neotree show")
    -- 포커스는 편집 창에 둔다 — 트리에 갇히지 않게.
    pcall(vim.cmd, "wincmd p")
  end)
end

-- 이 파일은 LazyVim 이 VeryLazy 시점에 읽는데, 그때는 VimEnter 가 이미 지나갔다.
-- VimEnter autocmd 만 걸어두면 영원히 발화하지 않으므로 진입 여부를 직접 본다.
if vim.v.vim_did_enter == 1 then
  open_filetree()
else
  vim.api.nvim_create_autocmd("VimEnter", {
    group = vim.api.nvim_create_augroup("auto_filetree", { clear = true }),
    callback = open_filetree,
    desc = "시작 시 파일트리 표시",
  })
end

