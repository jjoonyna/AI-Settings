-- Explicit user checkpoints only. Never watch spec/plan saves or ordinary status updates.
local M = {}
function M.show(path)
  path = vim.fn.fnamemodify(path or '', ':p')
  local normalized = path:gsub('\\', '/'):lower()
  if not normalized:match('/docs/user%-review/[^/]+%.md$') or vim.fn.filereadable(path) ~= 1 then
    return 'FAIL: docs/user-review/ 안의 기존 Markdown 검토 문서가 필요합니다'
  end
  local wt = vim.fn.exepath('wt.exe')
  if wt == '' then wt = (vim.env.LOCALAPPDATA or vim.fn.expand('~/AppData/Local')) .. '/Microsoft/WindowsApps/wt.exe' end
  if vim.fn.filereadable(wt) ~= 1 and vim.fn.executable(wt) ~= 1 then return 'FAIL: Windows Terminal을 찾을 수 없습니다' end
  vim.system({ wt, '-w', 'new', '--maximized', 'new-tab', '--title', '사용자 검토 | ' .. vim.fn.fnamemodify(path, ':t:r'),
    vim.v.progpath, '-i', 'NONE', '-u', vim.fn.stdpath('config') .. '/scripts/agent-plan-preview.lua', '-R', '-M', path },
    { text = true, timeout = 5000 }, vim.schedule_wrap(function(result)
      if result.code ~= 0 then vim.notify('사용자 검토 창 열기 실패: ' .. (result.stderr or ''), vim.log.levels.ERROR) end
    end))
  return 'OK: 사용자 검토 창 요청. 닫기는 승인이 아닙니다: ' .. path
end
function M.setup()
  _G.AgentPlanPreview = M.show
  _G.AgentUserReview64 = function(value)
    local ok, data = pcall(function() return vim.json.decode(vim.base64.decode(value)) end)
    return ok and M.show(data.path) or 'FAIL: 검토 요청 형식 오류'
  end
  vim.api.nvim_create_user_command('AgentPlanPreview', function(args)
    vim.notify(M.show(args.args ~= '' and args.args or vim.api.nvim_buf_get_name(0)))
  end, { nargs = '?', complete = 'file', desc = '사용자 검토 문서 열기 (Ctrl+D 닫기)' })
end
return M
