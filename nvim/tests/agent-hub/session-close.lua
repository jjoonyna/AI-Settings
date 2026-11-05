vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
vim.o.hidden, vim.o.columns, vim.o.lines = true, 160, 40
vim.env.AGENT_HUB_HOME = vim.fn.tempname()
require('config.agent.hub').setup()
local W, T = require('config.agent.workspace'), require('config.agent.terminal')
W.open(false)
local callbacks, seq = {}, 0
vim.fn.jobstart = function(_, opts)
  vim.bo.buftype = 'nofile'
  seq = seq + 1; vim.api.nvim_buf_set_lines(0, 0, -1, false, { 'session ' .. seq }); callbacks[seq] = opts.on_exit; return seq
end
local function spawn(role, parent)
  return assert(T.spawn({ agent = 'Codex', role = role, cmd = { 'synthetic' }, cwd = vim.fn.getcwd(), env = { AGENT_PARENT_ID = parent and tostring(parent) or nil } }))
end
local function close(id)
  local e = T.registry[id]; e.auto_close = true; callbacks[e.chan](e.chan, 0)
  assert(vim.wait(500, function() return not vim.api.nvim_buf_is_valid(e.buf) end, 10), 'cleanup')
end
local a, b, c = spawn('plan'), spawn('plan'), nil
c = spawn('work', b)
local s = W.state
close(c)
assert(vim.api.nvim_win_is_valid(s.chat) and s.selected == b and vim.api.nvim_win_get_buf(s.chat) == T.registry[b].buf, 'parent plan selected')
local d = spawn('work')
T.registry[a].auto_close = true
close(d)
assert(s.selected == b, 'other eligible plan selected')
T.registry[a].auto_close = false
assert(W.select(b, true))
local focus = vim.api.nvim_get_current_win()
close(a)
assert(s.selected == b and vim.api.nvim_get_current_win() == focus, 'hidden close preserves selection and focus')
local e = spawn('work')
T.registry[b].exit_code = 0
close(e)
assert(s.selected == nil and vim.api.nvim_win_get_buf(s.chat) == s.empty, 'exited plan excluded and empty shown')
T.registry[b].exit_code = nil
assert(W.select(b, false))
close(b)
assert(s.selected == nil and vim.api.nvim_win_get_buf(s.chat) == s.empty, 'last session shows empty')
local x, y = spawn('work'), spawn('work')
local z = spawn('work')
close(z)
assert(s.selected == x, 'remaining session uses lowest id')
close(y)
close(x)
local f = spawn('work')
vim.api.nvim_win_close(s.chat, true)
assert(W.select(f, false) and vim.api.nvim_win_is_valid(s.chat), 'destroyed chat restored')
local g = spawn('work')
assert(s.selected == g, 'new session after recovery')
local old = T.registry[g]
old.auto_close = true
callbacks[old.chan](old.chan, 0)
callbacks[old.chan](old.chan, 0)
assert(vim.wait(500, function() return not vim.api.nvim_buf_is_valid(old.buf) end, 10), 'duplicate cleanup')
assert(vim.api.nvim_win_is_valid(s.chat) and s.selected == f, 'duplicate cleanup preserves selected session')
local h = spawn('work', f)
T.registry[f].role = 'plan'
local timer_cb
local new_timer, jobwait, send = vim.uv.new_timer, vim.fn.jobwait, T.send
vim.uv.new_timer = function() return { start = function(_, _, _, cb) timer_cb = cb end, stop = function() end, close = function() end } end
vim.fn.jobwait = function() return { 0 } end
T.send = function() return true end
local hbuf = T.registry[h].buf
assert(T.done({ id = h }):match('^OK'))
timer_cb()
assert(vim.wait(500, function() return not vim.api.nvim_buf_is_valid(hbuf) end, 10), 'poll cleanup')
assert(s.selected == f and vim.api.nvim_win_is_valid(s.chat), 'poll fallback selects parent')
vim.uv.new_timer, vim.fn.jobwait, T.send = new_timer, jobwait, send
local R = require('config.agent.reviews')
local items = R.items
local path = vim.fn.tempname()
vim.fn.writefile({ '# Review document', 'Content' }, path)
R.items = function() return { { id = 'review', path = path, status = 'review_pending', owner = f, task_id = 'task' } } end
W.refresh()
assert(vim.api.nvim_win_is_valid(s.body) and vim.api.nvim_win_is_valid(s.docs), 'document panes open')
assert(W.select_review('review'))
local body, docs, document = s.body_buf, s.docs_buf, s.document
local body_lines, docs_lines = vim.api.nvim_buf_get_lines(body, 0, -1, false), vim.api.nvim_buf_get_lines(docs, 0, -1, false)
local hidden = spawn('work')
assert(W.select(f, false))
vim.api.nvim_set_current_win(s.body)
local document_focus = vim.api.nvim_get_current_win()
close(hidden)
assert(s.document == document and s.body_buf == body and s.docs_buf == docs
  and vim.api.nvim_win_get_buf(s.body) == body and vim.api.nvim_win_get_buf(s.docs) == docs
  and vim.deep_equal(vim.api.nvim_buf_get_lines(body, 0, -1, false), body_lines)
  and vim.deep_equal(vim.api.nvim_buf_get_lines(docs, 0, -1, false), docs_lines)
  and vim.api.nvim_get_current_win() == document_focus, 'hidden close preserves document panes and focus')
local selected = spawn('work', f)
vim.cmd('tabnew')
local other_tab, other_win = vim.api.nvim_get_current_tabpage(), vim.api.nvim_get_current_win()
close(selected)
assert(s.selected == f and vim.api.nvim_get_current_tabpage() == other_tab and vim.api.nvim_get_current_win() == other_win,
  'selected close preserves other tab and focus')
vim.api.nvim_win_close(s.chat, true)
assert(W.select(f, false), 'restore invalid chat from other tab')
assert(vim.api.nvim_get_current_tabpage() == other_tab and vim.api.nvim_get_current_win() == other_win
  and vim.api.nvim_win_is_valid(s.chat) and vim.api.nvim_win_get_buf(s.chat) == T.registry[f].buf,
  'chat recovery preserves other tab and focus')
R.items = items
print('PASS session close synthetic, polling, documents and other tab')
