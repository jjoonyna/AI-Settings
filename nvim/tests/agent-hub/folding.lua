local config = vim.fn.stdpath('config')
vim.opt.rtp:prepend(config)
vim.o.hidden, vim.o.columns = true, 140
vim.env.AGENT_HUB_HOME = vim.fn.tempname() .. '-fold'
require('config.agent.hub').setup()
local W, T = require('config.agent.workspace'), require('config.agent.terminal')
W.open(false)
assert(#W.state.rows == 0 and W.state.selected == nil
  and vim.api.nvim_win_get_buf(W.state.chat) == W.state.empty, 'empty list shows empty conversation')
local cmd = {vim.fn.exepath('node'), '-e', 'setInterval(()=>{},1000)'}
local a = assert(T.spawn({cmd=cmd, role='plan', name='A'}))
local b = assert(T.spawn({cmd=cmd, role='work', name='B', env={AGENT_PARENT_ID=tostring(a)}}))
local c = assert(T.spawn({cmd=cmd, role='plan', name='C'}))
local d = assert(T.spawn({cmd=cmd, role='work', name='D', env={AGENT_PARENT_ID=tostring(c)}}))
assert(W.select(b, false)); W.refresh()
assert(#W.state.rows == 3 and W.state.rows[2].entry.id == b, 'selected parent only expanded')
assert(vim.api.nvim_buf_get_lines(W.state.ai_buf, 2, 3, false)[1]:find('─', 1, true) == 1, 'separator between parent and child')
assert(W.select(d, false)); W.refresh()
assert(#W.state.rows == 3 and W.state.rows[3].entry.id == d, 'different parent expanded')
local s = W.state
vim.api.nvim_set_current_win(s.ai)
vim.api.nvim_win_set_cursor(s.ai, {s.rows[2].first, 0})
vim.fn.maparg('<Space>', 'n', false, true).callback()
assert(#s.rows == 2 and s.selected == d, 'manual fold retains selection')
W.refresh(); W.refresh()
assert(#s.rows == 2, 'refresh preserves manual fold')
assert(W.select(d, false)); W.refresh()
assert(#s.rows == 3, 'explicit reselection reopens')
local x, y = T.registry[c], T.registry[d]
local cases = {
  {'complete','complete','complete'}, {'working','error','working'},
  {'error','interrupted','error'}, {'interrupted','unknown','interrupted'},
  {'unknown','response_requested','unknown'}, {'idle','response_requested','response_requested'},
  {'idle','complete','idle'}, {'invalid','complete','unknown'},
}
vim.api.nvim_set_current_win(s.ai)
vim.api.nvim_win_set_cursor(s.ai, {s.rows[2].first, 0})
vim.fn.maparg('<Space>', 'n', false, true).callback()
for _, case in ipairs(cases) do
  x.status, y.status = case[1], case[2]
  W.refresh()
  assert(s.rows[2].displayed_status == case[3], 'aggregate ' .. table.concat(case, ','))
end
x.status, x.activity_status, y.status = 'review_pending', 'working', 'complete'
W.refresh(); assert(s.rows[2].displayed_status == 'working', 'underlying review activity')
for _, other in ipairs({'complete', 'idle', 'working'}) do
  x.status, x.activity_status, y.status = 'review_pending', 'review_pending', other
  W.refresh()
  assert(s.rows[2].displayed_status == (other == 'working' and 'working' or 'unknown'),
    'invalid underlying review_pending with ' .. other)
end
local review = assert(T.spawn({cmd=cmd, role='review', name='review', env={AGENT_PARENT_ID=tostring(a)}}))
assert(W.select(b, false)); assert(W.select(review, false))
assert(s.expanded == a and #s.rows == 4, 'same parent stays expanded')
assert(W.select(d, false)); assert(s.expanded == c and #s.rows == 3, 'other parent alone expands')
vim.api.nvim_set_current_win(s.ai)
vim.api.nvim_win_set_cursor(s.ai, {s.rows[2].first, 0})
vim.fn.maparg('<Space>', 'n', false, true).callback()
assert(s.selected == d and #s.rows == 2, 'selected hidden child remains selected')
W.close_session(T.registry[d])
assert(s.selected == c and s.expanded == c, 'close falls back to parent')
W.refresh()
vim.api.nvim_set_current_win(s.ai)
local first = s.rows[1].first
vim.api.nvim_win_set_cursor(s.ai, {first, 0})
vim.fn.maparg('j','n',false,true).callback()
assert(vim.api.nvim_win_get_cursor(s.ai)[1] == s.rows[2].first, 'keyboard uses variable rows')
vim.api.nvim_win_set_cursor(s.ai, {s.rows[2].first - 1, 0})
local previous = s.selected
vim.fn.maparg('<CR>','n',false,true).callback()
assert(s.selected == previous, 'blank separator does not select')
local panel = require('config.agent.panel')
local old = panel.rename
panel.rename = function() error('blank separator invoked rename') end
vim.fn.maparg('r','n',false,true).callback()
panel.rename = old
for _, background in ipairs({'light', 'dark'}) do
  vim.o.background = background
  vim.api.nvim_exec_autocmds('ColorScheme', {})
  assert(vim.api.nvim_get_hl(0,{name='AgentStatusWorking'}).fg, 'theme status restored')
  W.refresh()
  local marks = vim.api.nvim_buf_get_extmarks(s.ai_buf, vim.api.nvim_get_namespaces().agent_workspace_selection, 0, -1, {details=true})
  assert(#marks == 2 and marks[1][4].hl_eol and marks[2][4].hl_eol, 'two full width highlights')
end
local third = assert(T.spawn({cmd=cmd, role='plan', name='third'}))
local fourth = assert(T.spawn({cmd=cmd, role='plan', name='fourth'}))
W.refresh()
vim.api.nvim_set_current_win(s.ai)
local failures = {}
for i = 3, #s.rows do
  for key, target in pairs({j=i, ['<Down>']=i, k=i-1, ['<Up>']=i-1}) do
    vim.api.nvim_win_set_cursor(s.ai, {s.rows[i].first - 1, 0})
    vim.fn.maparg(key, 'n', false, true).callback()
    if vim.api.nvim_win_get_cursor(s.ai)[1] ~= s.rows[target].first then
      failures[#failures + 1] = key .. ' before group ' .. i
    end
  end
end
assert(#failures == 0, 'separator must move to adjacent item: ' .. table.concat(failures, ', '))
local removed_plan = T.registry[a]
T.registry[a] = nil
W.refresh()
for _, id in ipairs({b, review}) do
  assert(W.select(id, false) and s.expanded == nil, 'deleted plan child independently selectable')
  local found = false
  for _, item in ipairs(s.rows) do
    if item.entry.id == id then found = not item.arrow end
  end
  assert(found and vim.api.nvim_win_get_buf(s.chat) == T.registry[id].buf, 'orphan visible with own conversation')
end
assert(W.select(fourth, false))
local remaining = T.entries()
for _, e in ipairs(remaining) do if e.id ~= fourth then T.registry[e.id] = nil end end
W.close_session(T.registry[fourth])
T.registry[fourth] = nil
W.refresh()
assert(#s.rows == 0 and s.selected == nil and vim.api.nvim_win_get_buf(s.chat) == s.empty,
  'last selected session closes to empty list and conversation')
for _, e in ipairs(remaining) do if e.chan then vim.fn.jobstop(e.chan) end end
vim.fn.jobstop(removed_plan.chan)
print('PASS folding')
vim.cmd('qa!')
