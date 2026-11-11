vim.opt.rtp:prepend(vim.fn.stdpath('config'))
vim.g.mapleader = ' '
vim.o.hidden, vim.o.columns = false, 190
vim.env.AGENT_HUB_HOME = vim.fn.tempname() .. '-shortcuts'
local items = {}
package.loaded['config.agent.reviews'] = { items = function() return items end, decide = function() error('unexpected decision') end }
local W = require('config.agent.workspace')
require('config.agent').setup()
vim.api.nvim_feedkeys(' ad', 'xt', false)
local s = W.state
assert(s.docs and vim.api.nvim_win_is_valid(s.docs), 'empty documents list opens')
vim.api.nvim_feedkeys(' ad', 'xt', false); W.refresh()
assert(not s.docs or not vim.api.nvim_win_is_valid(s.docs), 'documents remain hidden')
vim.api.nvim_feedkeys(' al', 'xt', false); W.refresh()
assert(not s.ai or not vim.api.nvim_win_is_valid(s.ai), 'AI list remains hidden')
vim.api.nvim_feedkeys(' al', 'xt', false); assert(vim.api.nvim_get_current_win() == s.ai, 'AI list opens focused')
local path = vim.fn.tempname() .. ' 한글 file.txt'
vim.fn.writefile({'original'}, path)
local chat = vim.api.nvim_win_get_buf(s.chat)
assert(W.open_file(path), 'file opens')
local file = vim.api.nvim_win_get_buf(s.body)
local notify = vim.notify
vim.notify = function() end
assert(not W.open_file(path .. '.missing'), 'unreadable file rejected')
vim.notify = notify
assert(vim.api.nvim_win_get_buf(s.body) == file, 'failed open preserves body')
assert(vim.api.nvim_buf_get_name(file) == path and vim.api.nvim_win_get_buf(s.chat) == chat, 'file in body only')
vim.api.nvim_buf_set_lines(file, 0, -1, false, {'modified'})
items[1] = {id='review', path=path}
W.refresh()
assert(vim.api.nvim_win_get_buf(s.body) == file and vim.api.nvim_buf_get_lines(file,0,-1,false)[1] == 'modified', 'refresh preserves file')
W.decision('approved')
vim.o.columns = 40
W.refresh()
vim.api.nvim_feedkeys(' al', 'xt', false)
assert(s.ai and vim.api.nvim_win_is_valid(s.ai), 'explicit AI list at 40 columns')
vim.api.nvim_feedkeys(' al', 'xt', false)
vim.api.nvim_feedkeys(' al', 'xt', false)
assert(s.ai and vim.api.nvim_win_is_valid(s.ai), 'AI list reopens at 40 columns')
vim.api.nvim_feedkeys(' ad', 'xt', false)
assert(s.docs and vim.api.nvim_win_is_valid(s.docs), 'explicit document list at 40 columns')
vim.api.nvim_feedkeys(' ad', 'xt', false)
W.refresh()
assert(not s.docs and not s.ai, 'closed lists stay closed after refresh')
vim.o.columns = 50
vim.api.nvim_feedkeys(' ad', 'xt', false)
assert(s.docs and vim.api.nvim_win_is_valid(s.docs), 'explicit document list at 50 columns')
vim.api.nvim_feedkeys(' ad', 'xt', false)
W.refresh()
assert(vim.api.nvim_buf_is_valid(file) and vim.api.nvim_buf_get_lines(file,0,-1,false)[1] == 'modified', 'resize preserves hidden file')
vim.o.columns = 190
W.refresh()
assert(vim.api.nvim_win_get_buf(s.body) == file, 'resize restores file')
W.show('docs')
vim.api.nvim_set_current_win(s.docs)
W.decision('approved')
assert(W.select_review('review') and vim.api.nvim_win_get_buf(s.body) == s.body_buf, 'explicit review returns')
assert(vim.api.nvim_buf_get_lines(file,0,-1,false)[1] == 'modified', 'hidden unsaved file preserved')
vim.fn.delete(path)
print('PASS shortcuts')
