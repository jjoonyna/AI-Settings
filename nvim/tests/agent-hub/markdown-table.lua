vim.opt.rtp:prepend(vim.fn.stdpath('config'))
local T, dw = require('config.agent.markdown_table'), vim.fn.strdisplaywidth
local function eq(a, b, msg) assert(vim.deep_equal(a, b), msg .. ': ' .. vim.inspect(a)) end

local narrow = { '| a | b |', '|---|---|', '| 1 | 2 |' }
eq((T.fit(narrow, 40)), narrow, 'narrow table kept')

local wide = { 'text', '| 이름 | 설명 |', '|:--|--:|', '| `code` | **굵게** 와 \\| 파이프 ' .. ('아주 긴 설명 '):rep(8) .. 'Supercalifragilisticexpialidocious_Supercalifragilistic |', 'tail' }
local out, marks = T.fit(wide, 50)
eq({ out[1], out[#out] }, { 'text', 'tail' }, 'surrounding text kept')
local first = dw(out[2])
assert(out[2]:find('┌', 1, true) and first <= 50, 'grid top')
for k = 2, #out - 1 do assert(dw(out[k]) == first, 'aligned line ' .. k) end
local all = table.concat(out, '\n')
assert(all:find('code', 1, true) and not all:find('`', 1, true) and not all:find('**', 1, true), 'inline marks stripped')
assert(all:find('├', 1, true) and all:find('└', 1, true), 'separators')
for _, m in ipairs(marks) do
  assert(m[3] <= #out[m[1] + 1] and m[2] < m[3], 'mark in range')
  assert(m[4] == 'RenderMarkdownTableRow' or m[4] == 'RenderMarkdownTableHead')
end
assert(vim.tbl_contains(vim.tbl_map(function(m) return m[4] end, marks), 'RenderMarkdownTableHead'), 'head mark')

local fenced = { '```', unpack(wide, 2, 4) }
fenced[#fenced + 1] = '```'
eq((T.fit(fenced, 50)), fenced, 'fenced table ignored')
eq((T.fit(wide, 10)), wide, 'too narrow keeps source')
local bare = { '| a |', '|' }
eq((T.fit(bare, 40)), bare, 'lone pipe is not a separator')
assert(table.concat(out, '\n'):find('| 파이프', 1, true), 'escaped pipe shown as |')

local words = { '| 세션 | 설명 |', '|--|--|', '| Opus | ' .. ('긴 설명 문장 '):rep(20) .. ' |' }
local g = T.fit(words, 30)
assert(g[1]:find('┌', 1, true) and table.concat(g, '\n'):find('Opus', 1, true), 'longest word stays whole when floors fit')
local long = { '| Alphabetical | Bravoletters |', '|--|--|', '| Charlieword | Deltaletters ' .. ('x '):rep(30) .. ' |' }
local tight = T.fit(long, 20) -- floors 12+12 exceed the 13 available, so MIN floors apply
assert(tight[1]:find('┌', 1, true) and dw(tight[1]) <= 20, 'falls back to MIN floors in very narrow windows')
for _, l in ipairs(tight) do assert(dw(l) == dw(tight[1]), 'aligned fallback grid') end
vim.o.columns = 120
vim.cmd('vsplit'); vim.cmd('vertical resize 20') -- focus a window narrower than the grid
local korean = { '| 이름 | 설명 |', '|--|--|', '| 가나다 | ' .. ('한글과 English 섞인 긴 설명 '):rep(12) .. ' |' }
local kg = T.fit(korean, 100)
assert(kg[1]:find('┌', 1, true), 'korean table converted')
for _, l in ipairs(kg) do
  assert(vim.api.nvim_strwidth(l) == vim.api.nvim_strwidth(kg[1]) and vim.api.nvim_strwidth(l) <= 100, 'width independent of focused window')
end
print('PASS markdown-table')
