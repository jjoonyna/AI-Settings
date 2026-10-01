return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        -- ── JavaScript / TypeScript ──────────────────
        -- 현재 프론트엔드는 순수 JS(Vite). TS 전환 시에도 같은 서버가 처리한다.
        ts_ls = {
          settings = {
            javascript = {
              inlayHints = { includeInlayParameterNameHints = "literals" },
            },
          },
        },

        -- ── CSS / HTML / JSON ────────────────────────
        cssls = {},
        html = {},
        jsonls = {},

        -- ── Python ───────────────────────────────────
        -- `python` 명령은 Windows 스토어 별칭에 가려져 실패하므로
        -- 실제 인터프리터 경로를 명시한다(설계 §2-1).
        pyright = {
          settings = {
            python = {
              pythonPath = require("config.local_loader").get().python,
            },
          },
        },

        -- ── Java (jdtls) — 비활성 상태로 준비만 ──────
        -- 활성화하려면 아래 블록의 주석을 풀면 된다.
        -- 시스템 JAVA_HOME 은 JDK 1.6 이므로 반드시 21 을 명시해야 한다.
        -- Windows + Gradle 조합에서 초기 인덱싱이 오래 걸리고(10~30초)
        -- 메모리를 수백 MB 쓴다. 필요해지는 시점에 켠다.
        --
        -- jdtls = {
        --   cmd = {
        --     "<config/local.lua 의 jdk21>/bin/java",
        --     "-Declipse.application=org.eclipse.jdt.ls.core.id1",
        --     "-Dosgi.bundles.defaultStartLevel=4",
        --     "-Declipse.product=org.eclipse.jdt.ls.core.product",
        --     "-Xmx1G",
        --     "--add-modules=ALL-SYSTEM",
        --     "--add-opens", "java.base/java.util=ALL-UNNAMED",
        --     "--add-opens", "java.base/java.lang=ALL-UNNAMED",
        --   },
        --   settings = {
        --     java = {
        --       configuration = {
        --         runtimes = {
        --           { name = "JavaSE-21", path = "<config/local.lua 의 jdk21>" },
        --         },
        --       },
        --     },
        --   },
        -- },
      },
    },
  },

  -- ── 포매터 ──────────────────────────────────────────
  {
    "stevearc/conform.nvim",
    opts = {
      formatters_by_ft = {
        javascript = { "prettier" },
        typescript = { "prettier" },
        css = { "prettier" },
        html = { "prettier" },
        json = { "prettier" },
        jsonc = { "prettier" },
        yaml = { "prettier" },
        markdown = { "prettier" },
        lua = { "stylua" },
        -- Java 는 포매터를 붙이지 않는다.
        -- jdtls 를 켤 때 함께 결정한다.
      },
    },
  },
}
