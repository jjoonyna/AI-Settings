return {
  -- ── 구분선을 눈에 띄게 (설계 §4-2-9 ②) ──────────────
  {
    "folke/tokyonight.nvim",
    opts = {
      on_highlights = function(hl, c)
        -- 기본 구분선은 배경과 거의 구분되지 않는다. 밝기를 올린다.
        hl.WinSeparator = { fg = c.blue0, bold = true }
      end,
    },
  },

  -- ── 파일트리: 시작 시 자동 표시 (설계 §4-2-2) ────────
  {
    "nvim-neo-tree/neo-tree.nvim",
    opts = {
      window = { width = 35 },
      filesystem = {
        filtered_items = { visible = true, hide_dotfiles = false, hide_gitignored = false },
      },
    },
  },

  -- ── 세션: 이름 붙인 작업 세트 저장·전환 (설계 §4-2-7) ──
  {
    "folke/persistence.nvim",
    opts = {
      -- 세션을 폴더별로 저장한다 — 창마다 다른 폴더를 열면 자동으로 갈린다.
      dir = vim.fn.expand(vim.fn.stdpath("state") .. "/sessions/"),
      need = 1,
    },
    keys = {
      {
        "<leader>qs",
        function()
          require("persistence").load()
        end,
        desc = "이 폴더의 세션 복원",
      },
      {
        "<leader>ql",
        function()
          require("persistence").load({ last = true })
        end,
        desc = "마지막 세션 복원",
      },
      {
        "<leader>qd",
        function()
          require("persistence").stop()
        end,
        desc = "세션 저장 끄기",
      },
    },
  },
}
