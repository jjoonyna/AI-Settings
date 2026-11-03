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
function M.pick(callback)
  local agents = vim.tbl_filter(function(a) return policy.installation().mode ~= 'codex' or a.key == 'codex' end, M.AGENTS)
  vim.ui.select(agents, { prompt = '계획 세션', format_item = function(a) return a.label end }, function(agent)
    if not agent then return end
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
  end)
end
function M.open()
  M.pick(function(o)
    local T = require('config.agent.terminal')
    local title = policy.title('plan', o.name)
    local cmd = M.cmd_for(o.agent, 'plan', o.model, title)
    if vim.fn.executable(cmd[1]) ~= 1 then vim.notify('PATH에 ' .. cmd[1] .. ' 없음', vim.log.levels.ERROR); return end
    local id, err = T.spawn({ agent = o.agent == 'codex' and 'Codex' or 'Claude', cmd = cmd, cwd = o.cwd,
      name = title, role = 'plan', model = o.model, topic = o.name, session_name = title,
      env = { AGENT_SESSION_ROLE = 'plan', AGENT_SESSION_MODEL = o.model, AGENT_SESSION_VENDOR = o.agent, AGENT_SESSION_TITLE = title,
        AI_SETTINGS_HOME = policy.installation().runtime, IMPECCABLE_LIVE_COPY_AGENT = 'chat' } })
    if not id then vim.notify(tostring(err), vim.log.levels.ERROR) end
  end)
end
return M
