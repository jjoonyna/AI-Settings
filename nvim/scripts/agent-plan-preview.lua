-- 계획 검토 전용 창: 작업 프로세스가 없으며 Ctrl+d로 이 창만 닫는다.
vim.opt.swapfile = false
vim.opt.shadafile = 'NONE'
vim.opt.number = true
vim.opt.wrap = true
vim.opt.linebreak = true
vim.opt.breakindent = true
vim.opt.termguicolors = true
vim.opt.laststatus = 0
vim.opt.winbar = ' 계획 검토 · 읽기 전용 · Ctrl+d 닫기 '
vim.opt.rtp:append(vim.fn.stdpath('data') .. '/lazy/catppuccin')
pcall(function() require('catppuccin').setup({ flavour = 'mocha' }); vim.cmd.colorscheme('catppuccin-mocha') end)
vim.cmd('filetype plugin indent on')
vim.cmd('syntax enable')
vim.api.nvim_create_autocmd('BufWinEnter', { callback = function() vim.wo.spell = false end })
vim.keymap.set({ 'n', 'i', 'v' }, '<C-d>', '<Cmd>qa!<CR>', { silent = true, desc = '계획 검토 창 닫기' })
