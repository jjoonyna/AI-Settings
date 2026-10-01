-- 계획 문서는 작업 서버와 분리된 읽기 전용 창에서 보여준다.
local M = {}
local watched = {}
local timer
local hub = require('config.agent.hub')

function M.show(path, force)
  path = vim.fn.fnamemodify(path or '', ':p')
  if not path:lower():match('%.md$') or vim.fn.filereadable(path) ~= 1 then
    return '실패: 존재하는 Markdown 문서 경로가 필요합니다'
  end
  local dir = hub.root() .. '/previews'
  vim.fn.mkdir(dir, 'p')
  local server = '\\\\.\\pipe\\agent-preview-' .. hub.uid()
  local claim = dir .. '/' .. vim.fn.sha256(path:gsub('\\', '/'):lower()) .. '.json'
  if not force and vim.uv.fs_stat(claim) then return '이미 표시한 문서: ' .. path end
  local fd = vim.uv.fs_open(claim, force and 'w' or 'wx', 384)
  if not fd then return '다른 창에서 문서를 표시하고 있습니다' end
  vim.uv.fs_write(fd, vim.json.encode({ path = path, time = os.time(), server = server }), 0)
  vim.uv.fs_close(fd)
  local wt = vim.fn.exepath('wt.exe')
  -- Windows 실행 별칭은 exepath 검사에서 누락될 수 있다.
  if wt == '' then wt = (vim.env.LOCALAPPDATA or vim.fn.expand('~/AppData/Local')) .. '/Microsoft/WindowsApps/wt.exe' end
  if wt == '' then vim.uv.fs_unlink(claim); return '실패: Windows Terminal을 찾을 수 없습니다' end
  vim.system({ wt, '-w', 'new', '--maximized', 'new-tab', '--title', '계획 검토 · ' .. vim.fn.fnamemodify(path, ':t'),
    vim.v.progpath, '--listen', server, '-i', 'NONE', '-u', vim.fn.stdpath('config') .. '/scripts/agent-plan-preview.lua', '-R', '-M', path },
    { text = true, timeout = 5000 }, vim.schedule_wrap(function(result)
      if result.code ~= 0 then
        pcall(vim.uv.fs_unlink, claim)
        vim.notify('계획 문서 창 열기 실패: ' .. (result.stderr or ''), vim.log.levels.ERROR)
      end
    end))
  return '계획 문서 창 열기 요청: ' .. path
end

local function scan()
  local folders = { vim.fn.getcwd(), vim.fn.stdpath('config') }
  for _, entry in ipairs(require('config.agent.terminal').entries()) do folders[#folders + 1] = entry.cwd end
  for _, folder in ipairs(folders) do
    local dir = folder .. '/docs/superpowers/plans'
    local first = watched[dir] == nil
    watched[dir] = watched[dir] or {}
    if vim.fn.isdirectory(dir) == 1 then
      local known = watched[dir]
      for _, file in ipairs(vim.fn.glob(dir .. '/*.md', false, true)) do
        local stat = vim.uv.fs_stat(file)
        if stat then
          local stamp = tostring(stat.size) .. ':' .. stat.mtime.sec .. ':' .. stat.mtime.nsec
          if not known[file] then
            known[file] = { stamp = stamp, shown = first }
          elseif not known[file].shown then
            if known[file].stamp == stamp and stat.size > 0 then
              M.show(file)
              known[file].shown = true
            else known[file].stamp = stamp end
          end
        end
      end
    end
  end
end

function M.setup()
  if timer then return end
  _G.AgentPlanPreview = function(path) return M.show(path) end
  vim.api.nvim_create_user_command('AgentPlanPreview', function(args)
    vim.notify(M.show(args.args ~= '' and args.args or vim.api.nvim_buf_get_name(0), true))
  end, { nargs = '?', complete = 'file', desc = '계획 문서를 별도 최대화 창에서 보기' })
  scan()
  timer = vim.uv.new_timer()
  timer:start(5000, 5000, vim.schedule_wrap(scan))
  vim.api.nvim_create_autocmd('VimLeavePre', { once = true, callback = function()
    timer:stop(); timer:close(); timer = nil
  end })
end
return M



