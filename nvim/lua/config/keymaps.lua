-- LazyVim 기본 키맵 위에 개인 설정을 얹는다.

local map = vim.keymap.set

-- ── 창 이동: Alt+hjkl (터미널 모드 포함) ───────────────
-- 에이전트 터미널을 여러 개 띄우고 오가는 것이 주 동선이므로
-- 터미널 모드에서도 같은 키로 빠져나갈 수 있어야 한다.
map("n", "<A-h>", "<C-w>h", { desc = "왼쪽 창으로" })
map("n", "<A-j>", "<C-w>j", { desc = "아래 창으로" })
map("n", "<A-k>", "<C-w>k", { desc = "위 창으로" })
map("n", "<A-l>", "<C-w>l", { desc = "오른쪽 창으로" })

map("t", "<A-h>", "<C-\\><C-n><C-w>h", { desc = "왼쪽 창으로 (터미널)" })
map("t", "<A-j>", "<C-\\><C-n><C-w>j", { desc = "아래 창으로 (터미널)" })
map("t", "<A-k>", "<C-\\><C-n><C-w>k", { desc = "위 창으로 (터미널)" })
map("t", "<A-l>", "<C-\\><C-n><C-w>l", { desc = "오른쪽 창으로 (터미널)" })

-- 터미널 모드만 탈출 (창은 그대로)
map("t", "<C-q>", "<C-\\><C-n>", { desc = "터미널 모드 탈출" })

-- ── 오피스 파일은 nvim 으로 열지 않는다 (설계 §4-2-7) ──
-- xlsx·pptx·docx·pdf·hwp 는 바이너리라 nvim 에서 깨져 보인다.
-- AI 가 생성하고 사용자가 직접 여는 흐름이므로 기본 프로그램에 넘긴다.
map("n", "<leader>o", function()
  local path = vim.fn.expand("%:p")
  if path == "" then
    vim.notify("열 파일이 없습니다", vim.log.levels.WARN)
    return
  end
  vim.fn.jobstart({ "cmd.exe", "/c", "start", "", path }, { detach = true })
  vim.notify("기본 프로그램으로 열었습니다: " .. vim.fn.expand("%:t"))
end, { desc = "현재 파일을 기본 프로그램으로 열기" })

-- ── 한글 IME 매핑 로드 (Task 7) ───────────────────────
require("config.hangul").setup()

-- ── 에이전트 허브 (계획 B-2) ──────────────────────────
require("config.agent").setup()

-- 창 이동은 Alt+hjkl, 입력 모드 진입·탈출은 Ctrl+w / Ctrl+q로 통일한다.
map('n', '<C-w>', function() vim.cmd('startinsert') end, { nowait = true, desc = '입력 모드 진입' })
map('i', '<C-q>', '<Esc>', { desc = '입력 모드 탈출' })
