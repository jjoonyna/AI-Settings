-- 검증 뒤 갱신된 화면 실행 함수를 현재 세션에 반영한다.
local preview = require('config.agent.plan_preview')
local updated = dofile(vim.fn.stdpath('config') .. '/lua/config/agent/plan_preview.lua')
preview.show = updated.show
package.loaded['config.agent.launcher'] = nil
local entries = {}
for _, e in ipairs(require('config.agent.terminal').entries()) do
  entries[#entries + 1] = { id = e.id, pid = vim.fn.jobpid(e.chan), alive = vim.fn.jobwait({e.chan},0)[1] == -1 }
end
local markdown = {}
for _, b in ipairs(vim.api.nvim_list_bufs()) do
  if vim.bo[b].filetype:match('^markdown') then
    local sources = {}
    for _, d in ipairs(vim.diagnostic.get(b)) do sources[d.source or '기타'] = true end
    markdown[#markdown + 1] = { buf = b, sources = vim.tbl_keys(sources) }
  end
end
return vim.json.encode({ entries = entries, commands = {
  list = vim.fn.exists(':AgentList'), new = vim.fn.exists(':AgentNew'),
  detach = vim.fn.exists(':AgentDetach'), preview = vim.fn.exists(':AgentPlanPreview'),
}, markdown = markdown, theme = vim.g.colors_name })
