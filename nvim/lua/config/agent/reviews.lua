-- Review decisions belong to an exact session/task; completion is a separate parent action.
local M = {}
local hub = require('config.agent.hub')
local function path() return hub.root() .. '/reviews/' .. hub.id .. '.json' end
local function load()
  local data = hub.read(path())
  assert(data or not vim.uv.fs_stat(path()), '검토 상태 파일이 손상되었습니다: ' .. path())
  assert(not data or (data.version == 1 and type(data.items) == 'table'), '검토 상태 형식 오류: ' .. path())
  return data or { version = 1, items = {} }
end
local function save(data)
  local ok, err = hub.write(path(), data)
  assert(ok, err)
end
local function fingerprint(p)
  if vim.fn.filereadable(p) ~= 1 then return 'missing' end
  return vim.fn.sha256(table.concat(vim.fn.readfile(p, 'b'), '\n'))
end
function M.items()
  local data, changed = load(), false
  for _, item in ipairs(data.items) do
    local hash = fingerprint(item.path)
    if item.fingerprint ~= hash then
      item.fingerprint, item.status, changed = hash, 'review_pending', true
      local entry = require('config.agent.terminal').registry[item.owner]
      if entry and entry.task_id == item.task_id then entry.status = 'review_pending' end
    end
  end
  if changed then save(data) end
  return data.items
end
function M.register(o)
  local T = require('config.agent.terminal')
  local owner = tonumber(o.owner or o.session)
  if not owner then
    local entries = T.entries()
    if #entries == 1 then owner = entries[1].id end
  end
  local entry = T.registry[owner]
  if not entry or not entry.task_id then return 'FAIL: 정확한 owner/session을 지정하세요' end
  if o.task_id and o.task_id ~= entry.task_id then return 'FAIL: owner와 task_id 불일치' end
  local data = load()
  local item
  for _, r in ipairs(data.items) do
    if r.path == o.path and r.owner == owner and r.task_id == entry.task_id then item = r; break end
  end
  if not item then
    item = { id = hub.uid(), path = o.path, owner = owner, task_id = entry.task_id, parent_id = entry.parent_id }
    data.items[#data.items + 1] = item
  end
  item.fingerprint, item.status = fingerprint(o.path), 'review_pending'
  save(data)
  entry.status = 'review_pending'
  hub.publish()
  require('config.agent.workspace').refresh()
  return 'OK review=' .. item.id
end
function M.decide(id, decision, text)
  if decision ~= 'approved' and decision ~= 'changes_requested' then return 'FAIL: 잘못된 검토 결정' end
  local data = load()
  for _, item in ipairs(data.items) do
    if item.id == id then
      if fingerprint(item.path) == 'missing' then return 'FAIL: 검토 문서 파일을 읽을 수 없습니다' end
      if fingerprint(item.path) ~= item.fingerprint then M.items(); return 'FAIL: 문서가 변경되었습니다. 다시 검토하세요' end
      local T = require('config.agent.terminal')
      local entry = T.registry[item.owner]
      if not entry or entry.task_id ~= item.task_id then return 'FAIL: 소유 세션을 찾을 수 없습니다' end
      local ok, err = T.send(item.owner, '[사용자 검토 ' .. decision .. ']\n작업: ' .. item.task_id .. '\n문서: ' .. item.path .. '\n' .. (text or ''),
        { prompt = entry.agent == 'Codex' and '›' or '❯' })
      if not ok then return 'FAIL: ' .. tostring(err) end
      item.status = decision
      save(data)
      entry.status = decision == 'approved' and 'unknown' or 'response_requested'
      hub.publish()
      require('config.agent.workspace').refresh()
      return 'OK: ' .. decision
    end
  end
  return 'FAIL: 검토 요청 없음'
end
function M.complete(o)
  if type(o) ~= 'table' then return 'FAIL: 완료 확인 형식 오류' end
  local T = require('config.agent.terminal')
  local owner, parent = T.registry[tonumber(o.owner)], T.registry[tonumber(o.parent_id)]
  if not owner or owner.task_id ~= o.task_id or not parent
    or (owner.parent_id or owner.id) ~= parent.id or o.verified ~= true or o.reviewed ~= true then
    return 'FAIL: 정확한 owner/task_id/parent_id와 부모 검증·리뷰 확인이 필요합니다'
  end
  if parent.resume then
    local pending = require('config.agent.handoff').resolve_resume(parent, o.resolved_session)
    if pending then return pending end
  end
  if parent.role ~= 'plan' then return 'FAIL: 확인된 계획 세션만 작업 완료를 승인할 수 있습니다' end
  M.items()
  local data, kept = load(), {}
  for _, item in ipairs(data.items) do
    if item.owner == owner.id and item.task_id == o.task_id and item.status ~= 'approved' then
      return 'FAIL: 승인되지 않았거나 개정된 검토 문서가 있습니다'
    end
    if item.owner ~= owner.id or item.task_id ~= o.task_id then kept[#kept + 1] = item end
  end
  data.items = kept
  save(data)
  owner.status = 'complete'
  hub.publish()
  require('config.agent.workspace').refresh()
  return 'OK: 작업 완료 확인; 문서 파일 보존'
end
return M
