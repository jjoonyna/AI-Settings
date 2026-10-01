-- 현재 실행 중인 에이전트를 재시작하지 않고 새 기능을 연결한다.
local T = require('config.agent.terminal')
local before = {}
for _, e in ipairs(T.entries()) do before[e.id] = { chan = e.chan, buf = e.buf, pid = vim.fn.jobpid(e.chan) } end
require('config.agent.hub').setup()
package.loaded['config.agent'] = nil
require('config.agent').setup()
vim.keymap.set('n', '<C-w>', function() vim.cmd('startinsert') end, { nowait = true, desc = '입력 모드 진입' })
vim.keymap.set('i', '<C-q>', '<Esc>', { desc = '입력 모드 탈출' })
if not _G.__agent_hub_winbar_patched then
  local original = _G.__winbar
  if original then _G.__winbar = function() return (original():gsub('%%', '%%%%')) end end
  _G.__agent_hub_winbar_patched = true
end
local markdown = dofile(vim.fn.stdpath('config') .. '/lua/plugins/markdown.lua')
markdown[3].init()
local lint = require('lint')
markdown[1].opts(nil, lint)
local ns = lint.get_namespace('markdownlint-cli2')
vim.diagnostic.enable(false, { ns_id = ns })
vim.diagnostic.reset(ns)
markdown[2].opts(nil, require('conform'))
for _, win in ipairs(vim.api.nvim_list_wins()) do
  local buf = vim.api.nvim_win_get_buf(win)
  if vim.bo[buf].filetype:match('^markdown') then vim.wo[win].spell = false end
end
for id, previous in pairs(before) do
  local e = assert(T.registry[id], '기존 터미널 누락')
  assert(e.chan == previous.chan and e.buf == previous.buf and vim.fn.jobpid(e.chan) == previous.pid)
end
return vim.json.encode({ preserved = vim.tbl_count(before), hub = require('config.agent.hub').id,
  markdown_lint = lint.linters_by_ft.markdown, enter_mapping = vim.fn.maparg('<C-w>', 'n'),
  exit_mapping = vim.fn.maparg('<C-q>', 'i') })
