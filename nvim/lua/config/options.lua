-- LazyVim 기본 옵션 위에 개인 설정을 얹는다.
-- 이 파일은 lazy.nvim 이 플러그인을 로드하기 전에 자동으로 읽힌다.

local opt = vim.opt

-- ── 표시 ──────────────────────────────────────────────
opt.number = true
opt.relativenumber = true
opt.cursorline = true
opt.scrolloff = 8
opt.signcolumn = "yes"
opt.termguicolors = true
opt.wrap = false

-- ── 검색 ──────────────────────────────────────────────
opt.ignorecase = true
opt.smartcase = true
opt.hlsearch = true
opt.incsearch = true

-- ── 편집 ──────────────────────────────────────────────
opt.clipboard = "unnamedplus" -- 시스템 클립보드 공유
opt.mouse = "a"
opt.autoread = true           -- 외부 변경 자동 감지
opt.undofile = true           -- 종료 후에도 undo 유지

-- ── 인덴트 (기본값. 파일타입별 조정은 autocmds.lua) ──
-- Java 4칸 / JS·TS·CSS·JSON 2칸으로 갈린다.
opt.expandtab = true
opt.smartindent = true
opt.shiftwidth = 2
opt.tabstop = 2
opt.softtabstop = 2

-- ── 창 분할 (설계 §4-2-9 ①) ──────────────────────────
-- vsplit 은 항상 균등 폭을 유지하고, 수평 split 높이는 건드리지 않는다.
opt.splitright = true  -- vsplit 은 오른쪽에 생성
opt.splitbelow = true  -- split 은 아래에 생성
opt.equalalways = true -- 창을 열고 닫을 때 자동 균등화
-- 실측으로 확정한 값(hor = 가로 방향인 '폭'만 균등화).
--   hor → vsplit 3개 폭 26/26/26 균등, 높이는 분할 구조대로 유지
--   ver → 39/19/20 불균등
opt.eadirection = "hor"

-- ── 외부 도구를 nvim 프로세스 PATH 에만 추가 ─────────
-- 시스템 PATH 는 건드리지 않는다(설계 Global Constraints).
-- ripgrep: snacks.picker 의 파일·문자열 검색기. 없으면 느린 대체 경로를 타서
--          C:/DocsBackup(23,116 파일) 검색이 사실상 멎는다(plugins/search.lua).
local rg_dir = vim.fn.expand("~/AppData/Local/Programs/ripgrep")
if vim.fn.isdirectory(rg_dir) == 1 then
  vim.env.PATH = rg_dir .. ";" .. vim.env.PATH
end

-- lazygit: LazyVim 이 executable("lazygit") 검사로 <leader>gg 를 조건부 등록한다.
--          없으면 키맵 자체가 생기지 않는다.
local lazygit_dir = vim.fn.expand("~/AppData/Local/Programs/lazygit")
if vim.fn.isdirectory(lazygit_dir) == 1 then
  vim.env.PATH = lazygit_dir .. ";" .. vim.env.PATH
end

-- ── zig 를 nvim 프로세스 PATH 에만 추가 ──────────────
-- 시스템 PATH 는 건드리지 않는다(설계 Global Constraints).
-- nvim-treesitter 가 파서를 컴파일할 때 이 경로에서 zig 를 찾는다.
local zig_dir = vim.fn.expand("~/AppData/Local/Programs/zig")
if vim.fn.isdirectory(zig_dir) == 1 then
  vim.env.PATH = zig_dir .. ";" .. vim.env.PATH

  -- nvim-treesitter main 브랜치는 `tree-sitter build` CLI 로 파서를 컴파일하고,
  -- 그 CLI(Rust cc crate)는 C 컴파일러를 CC 환경변수에서 찾는다.
  -- zig 는 이름이 cc/gcc/cl 이 아니라 자동 탐지에 걸리지 않으므로 직접 지정한다.
  -- zigcc.cmd 는 cc crate 가 넘기는 MSVC 타겟 트리플을 zig 문법으로 바꿔주는 래퍼다.
  local zig_cc = zig_dir .. "/zigcc.cmd"
  if vim.fn.filereadable(zig_cc) == 1 and not vim.env.CC then
    vim.env.CC = vim.fn.fnamemodify(zig_cc, ":p"):gsub("/", "\\")
  end
end
