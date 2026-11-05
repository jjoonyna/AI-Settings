local M = {}
local function read(p)
  local ok, data = pcall(function() return vim.json.decode(table.concat(vim.fn.readfile(p), '\n')) end)
  return ok and data or nil
end
function M.installation()
  return read(vim.fn.stdpath('config') .. '/ai-settings.json')
    or { mode = 'both', runtime = vim.fn.fnamemodify(vim.fn.stdpath('config'), ':h') .. '/runtime' }
end
function M.catalog()
  local install = M.installation()
  return assert(read(install.models or (install.runtime .. '/models.json')), '모델 목록을 읽을 수 없습니다. 설치를 확인하세요.')
end
function M.model(id)
  for _, model in ipairs(M.catalog().models) do if model.id == id then return model end end
end
function M.cross_review_allowed()
  local snapshot = read(M.installation().runtime .. '/state/claude-usage.json')
  local now = os.time()
  if not snapshot or type(snapshot.observed_at) ~= 'number' or now - snapshot.observed_at > 120 or snapshot.observed_at > now + 5 then return false end
  for _, value in pairs(snapshot.windows or {}) do
    if type(value.used_percentage) == 'number' and value.used_percentage >= 80 and value.used_percentage <= 100 and type(value.resets_at) == 'number' and value.resets_at > now then return true end
  end
  return false
end
function M.validate(o)
  if not ({ plan = true, work = true, review = true })[o.session] then return nil, '알 수 없는 역할' end
  if o.agent ~= 'claude' and o.agent ~= 'codex' then return nil, '알 수 없는 벤더' end
  if o.agent == 'claude' and M.installation().mode == 'codex' then return nil, 'Codex 전용 설치입니다' end
  local selected = M.model(o.model or M.catalog().defaults[o.agent])
  if not selected or selected.vendor ~= o.agent then return nil, '모델/벤더가 일치하지 않습니다' end
  if o.parent_model then
    local parent = M.model(o.parent_model)
    if not parent then return nil, '호출 모델을 확인할 수 없습니다' end
    if o.parent_agent and parent.vendor ~= o.parent_agent then return nil, '호출 벤더/모델 불일치' end
    if not o.user_override then
      if selected.tier > parent.tier then return nil, '호출 모델보다 상위 모델은 사용자 지정이 필요합니다' end
      if parent.vendor == 'codex' and selected.vendor ~= 'codex' then return nil, 'Codex는 Codex만 호출합니다' end
      if parent.vendor ~= selected.vendor and (o.session ~= 'review' or not M.cross_review_allowed()) then return nil, '교차 위임은 Claude 한도 80% 이상일 때 리뷰만 가능합니다' end
    end
  elseif o.session ~= 'plan' then return nil, '작업·리뷰에는 호출 모델이 필요합니다' end
  return selected
end
function M.title(role, topic)
  local labels = { plan = '계획', work = '작업', review = '리뷰' }
  topic = vim.trim(tostring(topic or '새 작업')):gsub('[%c]', '')
  if topic == '' then topic = '새 작업' end
  return (labels[role] or role) .. ' | ' .. topic
end
function M.environment(extra)
  local install = M.installation()
  local env = vim.tbl_extend('force', { AI_SETTINGS_HOME = install.runtime, IMPECCABLE_LIVE_COPY_AGENT = 'chat' }, extra or {})
  if install.python and vim.fn.filereadable(install.python) == 1 then
    env.PATH = vim.fn.fnamemodify(install.python, ':h') .. (vim.fn.has('win32') == 1 and ';' or ':') .. (vim.env.PATH or '')
    env.VIRTUAL_ENV = vim.fn.fnamemodify(install.python, ':h:h')
  end
  return env
end
function M.resume_command(agent, mode)
  if mode ~= 'resume' and mode ~= 'continue' then return nil end
  if agent == 'codex' then return mode == 'continue' and { 'codex', 'resume', '--last' } or { 'codex', 'resume' } end
  if agent == 'claude' and M.installation().mode ~= 'codex' then
    return { 'claude', mode == 'continue' and '--continue' or '--resume' }
  end
end
-- Bash 허용 패턴·명령에서 백슬래시가 제거되므로 슬래시 경로를 쓴다
function M.report_cmd() return 'node ' .. (M.installation().runtime:gsub('\\', '/')) .. '/bin/session.mjs report' end
function M.command(agent, role, model, title, opts)
  model = model or M.catalog().defaults[agent]
  if agent == 'claude' then
    local cmd = { 'claude', '--model', model }
    if role == 'review' then
      vim.list_extend(cmd, { '--permission-mode', 'bypassPermissions' })
    end
    if title then vim.list_extend(cmd, { '--name', title }) end
    return cmd
  end
  local cmd = { 'codex', '--profile', role, '--model', model }
  return cmd
end
return M
