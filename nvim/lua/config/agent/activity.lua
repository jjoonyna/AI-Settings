local M = {}
M.labels = { unknown = '확인 불가', working = '작업 중', response_requested = '응답 요청',
  idle = '대기', review_pending = '검토 대기', complete = '완료', interrupted = '중단', error = '오류' }
function M.receive(o)
  if type(o) ~= 'table' then return 'FAIL: 상태 형식 오류' end
  local hub = require('config.agent.hub')
  local e = require('config.agent.terminal').registry[tonumber(o.owner)]
  if not e or o.instance ~= hub.id or o.token ~= e.event_token or e.exit_code ~= nil
    or type(o.at) ~= 'number' or o.at < e.event_started or o.at > os.time() * 1000 + 10000
    or o.at <= (e.event_at or 0) or not M.labels[o.status] or o.status == 'complete' or o.status == 'review_pending' then
    return 'FAIL: 오래되거나 다른 세션의 상태 이벤트'
  end
  if o.cli_session then
    if e.cli_session and e.cli_session ~= o.cli_session then return 'FAIL: CLI 세션 불일치' end
    e.cli_session = o.cli_session
    if e.resume and o.event == 'SessionStart' then
      require('config.agent.handoff').restore_resume(e, o.saved)
    end
  end
  local new_prompt = o.event == 'UserPromptSubmit' or (o.source == 'explicit' and o.status == 'working')
  if o.turn_id and e.active_turn and o.turn_id ~= e.active_turn and not new_prompt then return 'FAIL: 이전 CLI turn 이벤트' end
  if new_prompt then e.active_turn = o.turn_id end
  e.event_at, e.activity_status, e.status_source = o.at, o.status, o.source or 'explicit'
  if (e.status ~= 'complete' or new_prompt) and e.status ~= 'review_pending' then e.status = o.status end
  hub.publish()
  require('config.agent.workspace').refresh()
  return 'OK: ' .. o.status
end
function M.setup()
  _G.AgentActivity64 = function(value)
    local ok, data = pcall(function() return vim.json.decode(vim.base64.decode(value)) end)
    return ok and M.receive(data) or 'FAIL: 상태 형식 오류'
  end
end
return M
