-- 기존 터미널 레지스트리를 보존하면서 공통 작업 기능을 연결한다.
local M = {}
function M.install(T)
  if T.hub_installed then return end
  T.hub_installed = true
  local original_spawn = T.spawn
  local hub = require('config.agent.hub')
  function T.rename(id, name)
    local entry = T.registry[id]
    if not entry or not vim.api.nvim_buf_is_valid(entry.buf) then return false, '대상 터미널이 종료되었습니다' end
    if type(name) ~= 'string' then return false, '작업 이름을 입력하세요' end
    name = vim.trim(name)
    if name == '' or name:find('[%c]') then return false, '이름은 공백만 있거나 제어 문자를 포함할 수 없습니다' end
    entry.name = name
    vim.b[entry.buf].agent_name = name
    hub.publish()
    vim.cmd('redrawstatus')
    return true
  end
  function T.spawn(opts)
    local copy = vim.tbl_extend('force', {}, opts)
    local descriptor = { id = hub.uid(), name = opts.name or ((opts.agent or '에이전트') .. ' 작업'),
      cwd = opts.cwd, task_id = opts.task_id }
    hub.note(descriptor)
    if opts.initial_prompt then
      copy.cmd = vim.deepcopy(opts.cmd)
      copy.cmd[#copy.cmd + 1] = opts.initial_prompt(descriptor)
    end
    local id, err = original_spawn(copy)
    if not id then
      vim.fn.writefile({ '# 실행 실패', '', tostring(err) }, descriptor.note)
      return nil, err
    end
    local entry = T.registry[id]
    entry.task_id, entry.note = descriptor.task_id, descriptor.note
    if opts.name then entry.name = opts.name; vim.b[entry.buf].agent_name = opts.name end
    hub.publish()
    return id
  end
end
return M
