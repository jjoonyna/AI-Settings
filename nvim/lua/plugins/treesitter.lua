-- 파서 목록. nvim-treesitter main 브랜치는 tree-sitter CLI 로 컴파일한다.
return {
  {
    "nvim-treesitter/nvim-treesitter",
    opts = {
      ensure_installed = {
        -- 주 작업 언어
        "java",
        "javascript",
        "typescript",
        "tsx",
        "css",
        "html",
        "json",
        "jsonc",
        -- 문서 작업 (C:\DocsBackup)
        "markdown",
        "markdown_inline",
        -- 설정·스크립트
        "lua",
        "vim",
        "vimdoc",
        "bash",
        "yaml",
        "toml",
        "xml",
        "sql",
        "gitignore",
        "diff",
        -- 가끔 쓰는 것
        "python",
      },
    },
  },
}
