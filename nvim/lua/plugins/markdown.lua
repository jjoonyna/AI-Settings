-- Markdown 형식 검사는 끄고 Marksman 링크 진단은 유지한다.
return {
  {
    'mfussenegger/nvim-lint',
    opts = function(_, opts)
      opts.linters_by_ft = opts.linters_by_ft or {}
      opts.linters_by_ft.markdown = {}
      opts.linters_by_ft['markdown.mdx'] = {}
    end,
  },
  {
    'stevearc/conform.nvim',
    opts = function(_, opts)
      for _, ft in ipairs({ 'markdown', 'markdown.mdx' }) do
        local list = opts.formatters_by_ft and opts.formatters_by_ft[ft]
        if type(list) == 'table' then
          for i = #list, 1, -1 do
            if list[i] == 'markdownlint-cli2' then table.remove(list, i) end
          end
        end
      end
    end,
  },
  {
    'LazyVim/LazyVim',
    init = function()
      local group = vim.api.nvim_create_augroup('markdown_no_spell', { clear = true })
      vim.api.nvim_create_autocmd({ 'FileType', 'BufWinEnter' }, {
        group = group,
        callback = function(ev)
          if vim.bo[ev.buf].filetype:match('^markdown') then
            vim.schedule(function()
              for _, win in ipairs(vim.fn.win_findbuf(ev.buf)) do vim.wo[win].spell = false end
            end)
          end
        end,
        desc = 'Markdown 맞춤법 표시 끄기',
      })
    end,
  },
}
