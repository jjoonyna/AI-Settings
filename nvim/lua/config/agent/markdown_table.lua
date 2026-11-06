-- Pure display transform: pipe tables wider than the window become wrapped box grids.
local M = {}
local dw, MIN = vim.api.nvim_strwidth, 4 -- strdisplaywidth depends on the current window width
local ROW, HEAD = 'RenderMarkdownTableRow', 'RenderMarkdownTableHead'

local function split(line)
  line = vim.trim(line):gsub('^|', '')
  local cells, cur, prev = {}, {}, ''
  for _, ch in ipairs(vim.fn.split(line, '\\zs')) do
    if ch == '|' and prev ~= '\\' then cells[#cells + 1] = table.concat(cur); cur = {}
    else cur[#cur + 1] = ch end
    prev = ch
  end
  if #cur > 0 or prev == '\\' then cells[#cells + 1] = table.concat(cur) end
  return vim.tbl_map(vim.trim, cells)
end

local function is_sep(line)
  local cells = split(line)
  if #cells == 0 or not line:find('|', 1, true) then return false end
  for _, c in ipairs(cells) do
    if not c:match('^:?%-+:?$') then return false end
  end
  return true
end

local function clean(cell) return (cell:gsub('`', ''):gsub('%*%*', ''):gsub('__', ''):gsub('\\|', '|')) end

local function wrap(text, w)
  local out, cur = {}, ''
  for word in text:gmatch('%S+') do
    if dw(word) > w then
      if cur ~= '' then out[#out + 1] = cur; cur = '' end
      for _, ch in ipairs(vim.fn.split(word, '\\zs')) do
        if dw(cur .. ch) > w then out[#out + 1] = cur; cur = ch else cur = cur .. ch end
      end
    elseif cur == '' then cur = word
    elseif dw(cur) + 1 + dw(word) <= w then cur = cur .. ' ' .. word
    else out[#out + 1] = cur; cur = word end
  end
  out[#out + 1] = cur
  return out
end

local function col_widths(natural, avail, mins)
  local n, widths, fixed = #natural, {}, {}
  local rest, free = avail, n
  repeat
    local moved, share = false, rest / free
    for i = 1, n do
      if not fixed[i] and math.max(natural[i], MIN) <= share then
        fixed[i], widths[i] = true, math.max(natural[i], MIN)
        rest, free, moved = rest - widths[i], free - 1, true
      end
    end
  until not moved or free == 0
  local sum = 0
  for i = 1, n do if not fixed[i] then sum = sum + natural[i] end end
  for i = 1, n do
    if not fixed[i] then widths[i] = math.max(mins[i], math.floor(rest * natural[i] / sum)) end
  end
  local total = 0
  for _, w in ipairs(widths) do total = total + w end
  while total > avail do
    local big
    for i = 1, n do if widths[i] > mins[i] and (not big or widths[i] > widths[big]) then big = i end end
    if big then widths[big], total = widths[big] - 1, total - 1
    else for i = 1, n do mins[i] = MIN end end -- shortcut: word-keeping floor unreachable, fall back to MIN
  end
  return widths
end

-- Returns grid lines and marks, or nil when the table fits or cannot be fitted.
local function grid(rows, ncols, width)
  local natural = {}
  for c = 1, ncols do natural[c] = 0 end
  for _, r in ipairs(rows) do
    for c = 1, ncols do natural[c] = math.max(natural[c], dw(r[c])) end
  end
  local sum = 0
  for _, w in ipairs(natural) do sum = sum + w end
  local overhead = 3 * ncols + 1
  local avail = width - overhead
  if sum + overhead <= width or MIN * ncols > avail then return nil end
  -- Keep each column's longest word whole when the floors fit; otherwise floor at MIN.
  local mins, floor_sum = {}, 0
  for c = 1, ncols do
    local longest = 0
    for _, r in ipairs(rows) do
      for word in r[c]:gmatch('%S+') do longest = math.max(longest, dw(word)) end
    end
    mins[c] = math.max(MIN, math.min(natural[c], longest))
    floor_sum = floor_sum + mins[c]
  end
  if floor_sum > avail then for c = 1, ncols do mins[c] = MIN end end
  local widths = col_widths(natural, avail, mins)
  local out, marks = {}, {}
  local function add(pieces)
    local text, pos = {}, 0
    for _, p in ipairs(pieces) do
      text[#text + 1] = p[1]
      if p[2] then marks[#marks + 1] = { #out, pos, pos + #p[1], p[2] } end
      pos = pos + #p[1]
    end
    out[#out + 1] = table.concat(text)
  end
  local function border(l, m, r)
    local parts = {}
    for c, w in ipairs(widths) do parts[c] = ('─'):rep(w + 2) end
    add({ { l .. table.concat(parts, m) .. r, ROW } })
  end
  border('┌', '┬', '┐')
  for ri, r in ipairs(rows) do
    local wrapped, height = {}, 1
    for c = 1, ncols do wrapped[c] = wrap(r[c], widths[c]); height = math.max(height, #wrapped[c]) end
    for l = 1, height do
      local pieces = { { '│', ROW } }
      for c = 1, ncols do
        local t = wrapped[c][l] or ''
        pieces[#pieces + 1] = { ' ' .. t .. (' '):rep(widths[c] - dw(t)) .. ' ', ri == 1 and HEAD or nil }
        pieces[#pieces + 1] = { '│', ROW }
      end
      add(pieces)
    end
    if ri < #rows then border('├', '┼', '┤') end
  end
  border('└', '┴', '┘')
  return out, marks
end

function M.fit(lines, width)
  local out, marks, i, fence = {}, {}, 1, nil
  while i <= #lines do
    local line = lines[i]
    local f = line:match('^ ? ? ?(```+)') or line:match('^ ? ? ?(~~~+)')
    if fence then
      if f and f:sub(1, 1) == fence then fence = nil end
    elseif f then fence = f:sub(1, 1)
    elseif line:match('^ ? ? ?%S') and line:find('|', 1, true) and lines[i + 1] and is_sep(lines[i + 1]) then
      local ncols, j = #split(lines[i + 1]), i + 2
      while lines[j] and lines[j]:find('|', 1, true) and lines[j]:match('%S') do j = j + 1 end
      local rows = {}
      for k = i, j - 1 do
        if k ~= i + 1 then
          local cells = split(lines[k])
          while #cells > ncols do cells[ncols] = cells[ncols] .. ' | ' .. table.remove(cells) end
          local r = {}
          for c = 1, ncols do r[c] = clean(cells[c] or '') end
          rows[#rows + 1] = r
        end
      end
      local g, m = grid(rows, ncols, width)
      if g then
        for _, mark in ipairs(m) do mark[1] = mark[1] + #out; marks[#marks + 1] = mark end
        vim.list_extend(out, g)
      else
        vim.list_extend(out, lines, i, j - 1)
      end
      i = j - 1
      line = nil
    end
    if line then out[#out + 1] = line end
    i = i + 1
  end
  return out, marks
end

return M
