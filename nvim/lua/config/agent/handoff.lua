local M = {}
local policy = require('config.agent.policy')
local terminal = require('config.agent.terminal')

function M.build_prompt(o)
  local lines = {
    '역할: ' .. (o.session or 'work'), '작업: ' .. (o.name or ''),
    '목표: ' .. (o.goal or ''), '담당 범위: ' .. (o.scope or ''),
    '확정 결정·제약: ' .. (o.decisions or ''),
    'spec: ' .. (o.spec_doc or ''), 'plan: ' .. (o.plan_doc or ''),
    '관련 영구 문서: ' .. (o.references or ''), '작업 위치: ' .. (o.worktree or o.cwd or ''),
    '검증·완료 기준: ' .. (o.validation or ''), '중단 조건: 주요 구현 결정·범위 변경 또는 해결 불가 시 부모에게 보고',
    '보고 대상: ' .. (o.report_to or '부모 서버 ' .. (o.parent_server or '') .. ', 세션 ' .. tostring(o.parent_id or '')),
    o.prompt or '', '사용자 명시 지시 없이 커밋·머지·push 금지. 전체 대화 대신 필요한 문서 구간을 읽는다.',
    '보고는 완료 범위·변경 파일·검증 명령과 결과·미해결·다음 판단을 포함한다. AgentReport로 부모에게 전송하고 결과를 확인한다.',
  }
  if o.session == 'review' then lines[#lines + 1] = '읽기 전용 리뷰다. 코드 수정 및 수정 가능한 에이전트 위임 금지. 실제 변경 원문과 요구사항·테스트 증거를 읽고 근거를 보고한다.' end
  return table.concat(lines, '\n')
end
function M.receive(o)
  o = vim.deepcopy(o or {})
  o.session = o.session or 'work'; o.agent = o.agent or 'claude'
  local model, error = policy.validate(o)
  if not model then return 'FAIL: ' .. error end
  if not o.name or not o.goal or not o.scope or not o.validation or not o.prompt then return 'FAIL: name·goal·scope·validation·prompt가 필요합니다' end
  if not o.spec_doc or not o.plan_doc then return 'FAIL: spec_doc·plan_doc가 필요합니다' end
  for _, p in ipairs({ o.spec_doc, o.plan_doc }) do if vim.fn.filereadable(p) ~= 1 then return 'FAIL: 문서 없음 ' .. p end end
  local cwd = o.worktree or o.cwd or vim.fn.getcwd()
  if vim.fn.isdirectory(cwd) ~= 1 then return 'FAIL: 작업 폴더 없음' end
  o.parent_server = o.parent_server or vim.v.servername
  if not o.parent_id then
    local candidates = {}
    for _, e in ipairs(terminal.entries()) do if e.model == o.parent_model and e.role == 'plan' then candidates[#candidates + 1] = e end end
    if #candidates == 1 then o.parent_id = candidates[1].id end
  end
  if not o.parent_id or o.parent_server == '' then return 'FAIL: parent_id·parent_server로 보고 대상을 지정하세요' end
  local parent = terminal.registry[tonumber(o.parent_id)]
  if o.parent_server ~= vim.v.servername or not parent or parent.model ~= o.parent_model then return 'FAIL: 실제 호출 세션과 parent_model·parent_id·parent_server가 일치해야 합니다' end
  if parent.role == 'review' and o.session ~= 'review' then return 'FAIL: 리뷰 세션은 수정 가능한 작업을 위임할 수 없습니다' end
  local title = policy.title(o.session, o.name)
  local cmd = policy.command(o.agent, o.session, model.id, title)
  if vim.fn.executable(cmd[1]) ~= 1 then return 'FAIL: PATH에 ' .. cmd[1] .. ' 없음' end
  local git = vim.fn.systemlist({ 'git', '-C', cwd, 'branch', '--show-current' })
  o.worktree = cwd
  local id, why = terminal.spawn({ agent = o.agent == 'codex' and 'Codex' or 'Claude', cmd = cmd, cwd = cwd,
    branch = vim.v.shell_error == 0 and git[1] or nil, name = title, role = o.session, model = model.id, topic = o.name,
    session_name = title, briefing = M.build_prompt(o),
    env = { AGENT_SESSION_ROLE = o.session, AGENT_SESSION_MODEL = model.id, AGENT_SESSION_VENDOR = o.agent, AGENT_SESSION_TITLE = title,
      AGENT_PARENT_SERVER = o.parent_server, AGENT_PARENT_ID = tostring(o.parent_id), AI_SETTINGS_HOME = policy.installation().runtime,
      IMPECCABLE_LIVE_COPY_AGENT = 'chat' } })
  return id and ('OK id=' .. id .. ' model=' .. model.id .. ' title=' .. title) or ('FAIL: ' .. tostring(why))
end
function M.receive_report(o)
  if type(o) ~= 'table' or type(o.text) ~= 'string' or vim.trim(o.text) == '' then return 'FAIL: 보고 내용 없음' end
  local entry = terminal.registry[tonumber(o.parent_id)]
  if not entry then return 'FAIL: 부모 세션 없음' end
  local hub = require('config.agent.hub')
  local report = hub.root() .. '/reports/' .. hub.uid() .. '.json'
  if not hub.write(report, { from = o.from, text = o.text, parent_id = o.parent_id, time = os.time() }) then return 'FAIL: 보고 저장 실패' end
  local ok, why = terminal.send(entry.id, '[작업/리뷰 보고]\n' .. o.text, { prompt = entry.agent == 'Codex' and '›' or '❯' })
  return ok and ('OK report=' .. report) or ('FAIL: ' .. tostring(why))
end
function M.report(o)
  if not o or not o.parent_server then return 'FAIL: parent_server가 필요합니다' end
  if o.parent_server == vim.v.servername then return M.receive_report(o) end
  local ok, channel = pcall(vim.fn.sockconnect, 'pipe', o.parent_server, { rpc = true })
  if not ok or channel == 0 then return 'FAIL: 부모 서버 연결 실패' end
  local success, result = pcall(vim.fn.rpcrequest, channel, 'nvim_exec_lua', 'return require("config.agent.handoff").receive_report(...)', { o })
  vim.fn.chanclose(channel)
  return success and result or ('FAIL: ' .. tostring(result))
end
_G.AgentHandoff = M.receive
_G.AgentHandoff64 = function(value)
  local ok, data = pcall(function() return vim.json.decode(vim.base64.decode(value)) end)
  return ok and M.receive(data) or 'FAIL: 인계 형식 오류'
end
_G.AgentReport = M.report
_G.AgentReceiveReport64 = function(value)
  local ok, data = pcall(function() return vim.json.decode(vim.base64.decode(value)) end)
  return ok and M.receive_report(data) or 'FAIL: 보고 형식 오류'
end
return M
