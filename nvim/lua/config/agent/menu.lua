local M = {}
local policy = require('config.agent.policy')
M.AGENTS = {
  { key = 'claude', label = 'Claude Code', short = 'Claude' },
  { key = 'codex', label = 'Codex', short = 'Codex' },
}
function M.cmd_for(agent, role, model, title)
  if not ({ claude = true, codex = true })[agent] or not ({ plan = true, work = true, review = true })[role] then return nil end
  return policy.command(agent, role, model, title)
end
function M.pick(callback, mode)
  if not mode then
    vim.ui.select({ { key = 'new', label = '새 세션' }, { key = 'resume', label = '이어서 하기' }, { key = 'continue', label = '최근 세션 재개' } },
      { prompt = '시작 방식', format_item = function(item) return item.label end }, function(item)
        if item then M.pick(callback, item.key) end
      end)
    return
  end
  local agents = vim.tbl_filter(function(a) return policy.installation().mode ~= 'codex' or a.key == 'codex' end, M.AGENTS)
  local function chosen(agent)
    if not agent then return end
    if mode ~= 'new' then
      local cwd = vim.fn.getcwd()
      if mode == 'continue' then callback({ agent = agent.key, session = 'plan', resume = mode, cwd = cwd }); return end
      local script = policy.installation().runtime .. '/bin/session-list.mjs'
      vim.system({ 'node', script, agent.key, cwd }, { text = true }, vim.schedule_wrap(function(result)
        local ok, sessions = pcall(vim.json.decode, result.stdout or '')
        if result.code ~= 0 or not ok or type(sessions) ~= 'table' then vim.notify('저장 세션을 읽을 수 없습니다', vim.log.levels.ERROR); return end
        if #sessions == 0 then vim.notify('현재 폴더의 저장 세션이 없습니다', vim.log.levels.INFO); return end
        vim.ui.select(sessions, { prompt = '이어서 할 세션', format_item = function(item)
          return (item.title or '저장된 이름 확인 불가') .. '  [' .. item.id .. ']'
        end }, function(item)
          if item then callback({ agent = agent.key, session = 'plan', resume = mode, cwd = cwd, saved = item }) end
        end)
      end))
      return
    end
    local models = vim.tbl_filter(function(m) return m.vendor == agent.key end, policy.catalog().models)
    local default = policy.catalog().defaults[agent.key]
    table.sort(models, function(a, b) if a.id == default then return true elseif b.id == default then return false else return a.tier > b.tier end end)
    vim.ui.select(models, { prompt = '계획 모델', format_item = function(m) return m.label .. (m.id == default and ' (기본)' or '') end }, function(model)
      if not model then return end
      vim.ui.input({ prompt = '작업 주제: ' }, function(topic)
        if not topic or vim.trim(topic) == '' then return end
        callback({ agent = agent.key, session = 'plan', model = model.id, name = vim.trim(topic), cwd = vim.fn.getcwd() })
      end)
    end)
  end
  if #agents == 1 then chosen(agents[1]) else
    vim.ui.select(agents, { prompt = '에이전트', format_item = function(a) return a.label end }, chosen)
  end
end
function M.open(mode)
  M.pick(function(o)
    local T = require('config.agent.terminal')
    local title = o.resume and (o.saved and o.saved.title or '재개 | 저장된 이름 확인 불가') or policy.title('plan', o.name)
    local cmd
    if o.resume then cmd = policy.resume_command(o.agent, o.resume, o.saved and o.saved.id) else cmd = M.cmd_for(o.agent, 'plan', o.model, title) end
    if not cmd then vim.notify('잘못된 실행 요청', vim.log.levels.ERROR); return end
    if vim.fn.executable(cmd[1]) ~= 1 then vim.notify('PATH에 ' .. cmd[1] .. ' 없음', vim.log.levels.ERROR); return end
    require('config.agent.workspace').open(false)
    local id, err = T.spawn({ agent = o.agent == 'codex' and 'Codex' or 'Claude', cmd = cmd, cwd = o.cwd,
      name = title, resume = o.resume, saved = o.saved, role = not o.resume and 'plan' or nil, model = o.model, topic = o.name, session_name = not o.resume and title or nil,
      env = { AGENT_SESSION_ROLE = not o.resume and 'plan' or nil, AGENT_SESSION_MODEL = o.model, AGENT_SESSION_VENDOR = o.agent, AGENT_SESSION_TITLE = not o.resume and title or nil,
        AI_SETTINGS_HOME = policy.installation().runtime, IMPECCABLE_LIVE_COPY_AGENT = 'chat' } })
    if not id then vim.notify(tostring(err), vim.log.levels.ERROR) end
  end, mode)
end
return M
