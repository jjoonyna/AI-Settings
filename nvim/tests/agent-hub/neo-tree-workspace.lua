vim.opt.rtp:prepend(vim.fn.stdpath('config'))
local lazy = vim.fn.stdpath('data') .. '/lazy/'
for _, name in ipairs({'plenary.nvim', 'nui.nvim', 'nvim-web-devicons', 'neo-tree.nvim'}) do vim.opt.rtp:append(lazy .. name) end
vim.g.mapleader = ' '
vim.o.hidden, vim.o.columns = true, 190
vim.env.AGENT_HUB_HOME = vim.fn.tempname() .. '-tree'
local root = vim.fn.tempname() .. ' tree'
vim.fn.mkdir(root, 'p')
local path = root .. '/한글 file.txt'
vim.fn.writefile({'hello'}, path)
vim.cmd.cd(vim.fn.fnameescape(root))
package.loaded['config.agent.reviews'] = {items = function() return {} end}
local opts
for _, plugin in ipairs(dofile(vim.fn.stdpath('config') .. '/lua/plugins/ui.lua')) do if plugin[1] == 'nvim-neo-tree/neo-tree.nvim' then opts = plugin.opts end end
require('neo-tree').setup(opts)
local W = require('config.agent.workspace')
require('config.agent').setup()
vim.api.nvim_feedkeys(' ae', 'xt', false)
local state = require('neo-tree.sources.manager').get_state('filesystem')
assert(vim.wait(10000, function() return state.tree and #vim.api.nvim_buf_get_lines(state.bufnr, 0, -1, false) >= 2 end, 50), 'tree loads file')
assert(state.winid and vim.api.nvim_win_is_valid(state.winid), 'real tree open')
local line = 2
vim.api.nvim_set_current_win(state.winid)
vim.api.nvim_win_set_cursor(state.winid, {line, 0})
vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<CR>', true, false, true), 'xt', false)
assert(vim.wait(5000, function() return W.state.body and vim.fs.normalize(vim.api.nvim_buf_get_name(vim.api.nvim_win_get_buf(W.state.body))) == vim.fs.normalize(path) end, 50), 'Enter opens file in body')
print('PASS actual Neo-tree Enter')
