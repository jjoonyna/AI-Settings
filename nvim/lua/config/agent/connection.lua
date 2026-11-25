local M = {}
local function nonempty(v) return type(v) == 'string' and v ~= '' end
local function uuid(v) return type(v) == 'string' and v:match('^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$') end
local function vendor(e) return e.agent == 'Codex' and 'codex' or e.agent == 'Claude' and 'claude' or nil end
local function fail(code) return {ok=false,code=code,error=code} end
function M.resolve(identity)
  if type(identity) ~= 'table' then return fail('identity') end
  local hub = require('config.agent.hub')
  local exact = nonempty(identity.instance) and type(identity.owner) == 'number' and identity.owner > 0 and nonempty(identity.task_id)
  local cli = uuid(identity.cli_session) and (identity.vendor == 'codex' or identity.vendor == 'claude')
  if (identity.instance ~= nil or identity.owner ~= nil or identity.task_id ~= nil) and not exact then return fail('identity') end
  if not exact and not cli then return fail('identity') end
  if exact and identity.instance ~= hub.id then return fail('identity') end
  if identity.cli_session ~= nil and not cli then return fail('identity') end
  local found = {}
  for _, e in ipairs(require('config.agent.terminal').entries()) do
    if e.exit_code == nil and nonempty(e.task_id)
      and (not exact or (e.id == identity.owner and e.task_id == identity.task_id))
      and (not cli or (e.cli_session == identity.cli_session and vendor(e) == identity.vendor)) then
      local b = {server=vim.v.servername,instance=hub.id,owner=e.id,task_id=e.task_id,parent_id=e.parent_id}
      if uuid(e.cli_session) and vendor(e) then b.vendor,b.cli_session = vendor(e),e.cli_session end
      found[#found+1] = b
    end
  end
  if #found ~= 1 then return fail(#found > 1 and 'ambiguous' or 'identity') end
  return {ok=true,binding=found[1]}
end
local actions = {handoff='AgentHandoff64',preview='AgentUserReview64',report='AgentReceiveReport64',
  ['task-complete']='AgentTaskComplete64',activity='AgentActivity64'}
function M.invoke(request)
  if type(request) ~= 'table' or type(request.binding) ~= 'table' or type(request.payload) ~= 'table'
    or (not actions[request.action] and request.action ~= 'status') then return 'FAIL: invocation format' end
  local b,p = request.binding,request.payload
  local checked = M.resolve(b)
  if not checked.ok or b.server ~= vim.v.servername then return 'FAIL: identity' end
  if p.session_tools ~= nil then
    local guard = p.session_tools
    local entry = require('config.agent.terminal').registry[b.owner]
    local function real(value)
      local result = type(value) == 'string' and vim.uv.fs_realpath(value)
      if not result then return nil end
      result = result:gsub('\\', '/'):gsub('/+$', '')
      return vim.fn.has('win32') == 1 and result:lower() or result
    end
    if type(guard) ~= 'table' or not vendor(entry) or b.vendor~=vendor(entry) or guard.role ~= entry.role or guard.model ~= entry.model
      or not real(guard.cwd) or real(guard.cwd) ~= real(entry.cwd)
      or not require('config.agent.handoff').verified_role(entry) then return 'FAIL: session tools identity' end
    if guard.transport~=nil or vendor(entry)=='codex' and entry.transport~=nil then
      local proof,t=guard.transport,entry.transport
      if type(proof)~='table' or type(t)~='table' or vendor(entry)~='codex' or t.vendor~='codex'
        or t.ready~=true or t.mcp_verified~=true or t.cli_session~=b.cli_session or t.expected_cli~=b.cli_session
        or proof.cli_session~=b.cli_session or proof.endpoint~=t.endpoint or not real(t.manifest)
        or vim.fn.fnamemodify(t.manifest,':t')~='launch.message.json'
        or not real(proof.context) or real(proof.context)~=real(vim.fn.fnamemodify(t.manifest,':h')..'/launch.bound.message.json')
        or not real(proof.executable) or real(proof.executable)~=real(t.executable)
        or not real(proof.runtime) or real(proof.runtime)~=real(require('config.agent.policy').installation().runtime)
        or not real(proof.hub) or real(proof.hub)~=real(require('config.agent.hub').root()) then return 'FAIL: session tools transport identity' end
    end
    if guard.inbox~=nil or vendor(entry)=='claude' then
      local proof,t=guard.inbox,entry.transport
      if type(proof)~='table' or type(t)~='table' or vendor(entry)~='claude' or t.vendor~='claude'
        or t.ready~=true or t.ready_claimed~=true or t.model_verified~=true or t.model_failed or proof.cli_session~=b.cli_session
        or t.expected_cli~=b.cli_session or t.cli_session~=b.cli_session then return 'FAIL: session tools inbox identity' end
    end
    local plan = entry.role == 'plan'
    if (request.action == 'handoff' or request.action == 'preview' or request.action == 'task-complete') and not plan
      or request.action == 'report' and (plan or (entry.role ~= 'work' and entry.role ~= 'review'))
      or request.action == 'status' and not plan and (p.owner ~= b.owner or p.task_id ~= b.task_id)
      or request.action == 'activity' then return 'FAIL: session tools role' end
    if request.action == 'task-complete' then
      local child = require('config.agent.terminal').registry[p.owner]
      if not child or child.id == b.owner or child.parent_id ~= b.owner or child.task_id ~= p.task_id then return 'FAIL: target relationship' end
    end
    if request.action == 'handoff' and (p.parent_model ~= entry.model or p.parent_agent ~= vendor(entry)
      or (vendor(entry)=='codex' and p.agent~='codex')
      or p.user_override or (p.session ~= 'work' and p.session ~= 'review') or real(p.cwd) ~= real(entry.cwd)
      or real(p.worktree) ~= real(entry.cwd)) then return 'FAIL: session tools handoff' end
    if request.action == 'handoff' or request.action == 'preview' then
      local function document(value)
        local base = real(entry.cwd)
        local docs = real(entry.cwd .. '/docs')
        local file = real(value)
        local stat = file and vim.uv.fs_stat(value)
        return docs == base .. '/docs' and file and file:sub(1,#docs+1) == docs .. '/'
          and file:sub(-3) == '.md' and stat and stat.type == 'file' and stat.size <= 256*1024
      end
      if request.action == 'preview' and not document(p.path)
        or request.action == 'handoff' and (not document(p.spec_doc) or not document(p.plan_doc)) then return 'FAIL: session tools path' end
    end
  end
  if request.action == 'handoff' and (p.parent_id ~= b.owner or p.parent_server ~= b.server)
    or request.action == 'preview' and (p.owner ~= b.owner or p.task_id ~= b.task_id or p.session ~= nil and tonumber(p.session) ~= b.owner)
    or request.action == 'task-complete' and p.parent_id ~= b.owner
    or request.action == 'report' and (p.owner ~= b.owner or p.task_id ~= b.task_id or p.parent_id ~= checked.binding.parent_id)
    or request.action == 'activity' and (p.owner ~= b.owner or p.instance ~= b.instance) then return 'FAIL: payload identity' end
  if request.action == 'status' then
    local entry = require('config.agent.terminal').registry[p.owner]
    if not entry or entry.task_id ~= p.task_id or (entry.id ~= b.owner and entry.parent_id ~= b.owner) then return 'FAIL: target relationship' end
    local result = {id=entry.id,task_id=entry.task_id,role=entry.role or vim.NIL,model=entry.model or vim.NIL,status=entry.status or vim.NIL,
      activity_status=entry.activity_status or vim.NIL,exit_code=entry.exit_code or vim.NIL,report=entry.latest_report or vim.NIL}
    if entry.report_delivery then
      local d=entry.report_delivery
      result.report_delivery={state=d.state,message_id=d.message_id,execution='not_observed'}
      local parent=require('config.agent.terminal').registry[entry.parent_id]
      for _,message in ipairs(parent and parent.messages or {}) do
        if message.id==d.message_id then
          result.report_delivery={state=message.state,message_id=message.id,receipt=message.receipt,execution='not_observed'}
          break
        end
      end
    end
    return vim.json.encode(result)
  end
  local fn = _G[actions[request.action]]
  if not fn then return 'FAIL: unsupported action; update/restart Neovim' end
  return fn(vim.base64.encode(vim.json.encode(p)))
end
function M.setup()
  _G.AgentSessionResolve64 = function(value)
    local ok,data = pcall(function() return vim.json.decode(vim.base64.decode(value)) end)
    return vim.json.encode(ok and M.resolve(data) or fail('protocol'))
  end
  _G.AgentSessionInvoke64 = function(value)
    local ok,data = pcall(function() return vim.json.decode(vim.base64.decode(value)) end)
    return ok and M.invoke(data) or 'FAIL: invocation format'
  end
end
return M
