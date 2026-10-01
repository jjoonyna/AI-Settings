-- C:\DocsBackup 은 총 23,109 파일이고 대부분이 바이너리다
-- (tdms 14,191 / parquet 1,130 / bin 483 / cab 432 / msi 305 ...).
-- 제외하지 않으면 파일 검색·전체 문자열 검색이 사실상 멎는다.

local EXCLUDE_DIRS = {
  "node_modules", ".git", "dist", "build", "target",
  ".gradle", ".idea", "bin", "obj", "logs",
}

local EXCLUDE_GLOBS = {
  "*.tdms", "*.parquet", "*.bin", "*.cab", "*.msi", "*.mst",
  "*.class", "*.jar", "*.zip", "*.7z", "*.log", "*.bcmap",
  "*.exe", "*.dll", "*.pdb", "*.png", "*.jpg", "*.jpeg",
  "*.gif", "*.ico", "*.pdf", "*.xlsx", "*.xls", "*.pptx",
  "*.docx", "*.hwp", "*.hwpx", "*.eng", "*.p7b",
}

-- snacks.picker 용 제외 목록. `ignored = true` 로 .gitignore 를 무시하므로
-- (docs/·CLAUDE.md·.agent-shared.md 같은 gitignore 문서를 찾기 위해)
-- node_modules·dist 같은 폴더는 여기서 직접 걸러야 한다.
local EXCLUDE_ALL = vim.list_extend(vim.deepcopy(EXCLUDE_DIRS), EXCLUDE_GLOBS)

-- ripgrep 인자로 변환 (Telescope 용)
local rg_args = { "--hidden", "--no-ignore" }
for _, d in ipairs(EXCLUDE_DIRS) do
  table.insert(rg_args, "--glob")
  table.insert(rg_args, "!**/" .. d .. "/**")
end
for _, g in ipairs(EXCLUDE_GLOBS) do
  table.insert(rg_args, "--glob")
  table.insert(rg_args, "!" .. g)
end

-- 파일 파인더에서 고른 파일을 항상 새 세로 분할 창으로 열고,
-- 그 버퍼에서 <C-d> 로 창을 닫을 수 있게 한다.
-- 버퍼 번호를 jump 전에 bufadd 로 확보해 키맵을 먹이므로 타이밍 문제가 없다
-- (jump 는 입력 모드에서 호출되면 한 틱 뒤로 미뤄진다).
local function open_in_new_win(picker, item, action)
  for _, it in ipairs(picker:selected({ fallback = true })) do
    local path = Snacks.picker.util.path(it)
    if path then
      local buf = vim.fn.bufadd(path)
      vim.keymap.set("n", "<C-d>", "<cmd>close<CR>", { buffer = buf, desc = "파인더로 연 창 닫기" })
    end
  end
  -- M.vsplit 은 confirm 을 다시 부르는 스펙이라 순환이 생기므로 jump 를 직접 호출한다
  Snacks.picker.actions.jump(picker, item, { cmd = "vsplit" })
end

return {
  {
    "folke/snacks.nvim",
    opts = {
      picker = {
        sources = {
          files = { hidden = true, ignored = true, exclude = EXCLUDE_ALL, confirm = open_in_new_win },
          grep = { hidden = true, ignored = true, exclude = EXCLUDE_ALL },
          explorer = { hidden = true, ignored = true, exclude = EXCLUDE_ALL },
        },
      },
    },
  },
  -- Telescope 를 함께 쓰는 경우를 대비한 설정.
  -- LazyVim 기본 검색기는 snacks.picker 이므로 위쪽이 주력이다.
  {
    "nvim-telescope/telescope.nvim",
    optional = true,
    opts = {
      defaults = {
        vimgrep_arguments = vim.list_extend(
          { "rg", "--color=never", "--no-heading", "--with-filename", "--line-number", "--column", "--smart-case" },
          rg_args
        ),
        file_ignore_patterns = EXCLUDE_GLOBS,
      },
    },
  },
}
