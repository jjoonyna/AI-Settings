-- Management messages use API/inbox workers. No terminal input or screen inspection.
local M = { max_bytes = 256 * 1024, max_pending = 16, ttl = 120 }
local function uuid(s) return type(s)=='string' and s:match('^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$') end
local function vendor(e) return e.agent=='Codex' and 'codex' or e.agent=='Claude' and 'claude' end
local function current(e,q)
  if q.sender then
    local sender=require('config.agent.terminal').registry[q.sender.owner]
    if not sender or sender.parent_id~=e.id or sender.task_id~=q.sender.task_id or sender.cli_session~=q.sender.cli_session
      or sender.role~=q.sender.role or sender.model~=q.sender.model then return false end
  end
  return require('config.agent.terminal').registry[e.id]==e and e.exit_code==nil and e.task_id==q.task_id
    and e.role==q.role and e.model==q.model and e.cli_session==q.cli_session
end
local function queue(e) e.messages=e.messages or {};return e.messages end
local function valid(e)
  return type(e.task_id)=='string' and e.task_id~='' and ({plan=true,work=true,review=true})[e.role]
    and type(e.model)=='string' and uuid(e.cli_session) and e.transport and e.transport.ready
    and e.transport.vendor==vendor(e) and e.transport.cli_session==e.cli_session
    and (vendor(e)~='claude' or e.transport.model_verified==true and not e.transport.model_failed)
    and require('config.agent.terminal').registry[e.id]==e
end
local function settle(e,q,result)
  if not current(e,q) or not e.transport.ready then q.state='unknown';q.detail='binding changed';q.text=nil;q.on_result=nil;return end
  q.state=({accepted=true,failed=true,unknown=true})[result.state] and result.state or 'unknown'
  q.receipt=result.receipt;q.detail=result.detail;q.text=nil;e.last_message=q.id
  if q.on_result then pcall(q.on_result,result);q.on_result=nil end
  if q.state~='accepted' then vim.notify('관리 메시지 '..q.id..': '..q.state..' (자동 재전송 없음)',vim.log.levels.WARN) end
end
function M.execute(e,q,callback)
  local env=vim.fn.environ()
  for k in pairs(env) do
    local upper=k:upper()
    if upper:match('^AGENT_') or upper=='CODEX_THREAD_ID' or upper=='CODEX_SESSION_ID' or upper=='CLAUDE_SESSION_ID'
      or upper:match('^CLAUDE_CODE_MESSAGING_') or upper:match('^CLAUDE_CODE_SESSION_') then env[k]=nil end
  end
  env.NVIM=vim.v.servername
  local root=require('config.agent.policy').installation().runtime
  local input={identity={instance=require('config.agent.hub').id,owner=e.id,task_id=e.task_id,vendor=vendor(e),cli_session=e.cli_session,token=e.event_token},
    message_id=q.id,operation=q.operation,text=q.text}
  vim.system({'node',root..'/bin/session-message.mjs'},{text=true,env=env,stdin=vim.json.encode(input)},vim.schedule_wrap(function(r)
    local ok,value=pcall(vim.json.decode,r.stdout or '')
    callback(ok and type(value)=='table' and value or {state='unknown',detail='worker response unavailable'})
  end))
end
function M.pump(e)
  if not valid(e) or vendor(e)~='codex' or e.message_worker then return end
  for _,q in ipairs(queue(e)) do
    if q.state=='pending' then
      if not current(e,q) or os.time()-q.created>M.ttl then
        q.state='failed';q.detail='expired or stale binding';q.text=nil
        vim.notify('관리 메시지 '..q.id..' 만료/신원 변경: 자동 재전송 없음',vim.log.levels.WARN)
      else
        e.message_worker=true;q.state='dispatching'
        local ok=pcall(M.execute,e,q,function(r) settle(e,q,r);e.message_worker=nil;M.pump(e) end)
        if not ok then settle(e,q,{state='unknown',detail='worker launch unavailable'});e.message_worker=nil end
        return
      end
    end
  end
end
local function submit(e,text,opts,operation)
  if not valid(e) or e.exit_code~=nil or not require('config.agent.handoff').verified_role(e) then return false,'검증된 UUID/역할/API 또는 수신함 준비가 필요합니다' end
  if type(text)~='string' or #text==0 or #text>M.max_bytes or text:find('%z') then return false,'메시지 크기/형식 오류' end
  local sender
  if opts and opts.sender then
    local source=require('config.agent.terminal').registry[opts.sender.owner]
    if not source or source.parent_id~=e.id or source.task_id~=opts.sender.task_id or source.cli_session~=opts.sender.cli_session
      or not uuid(source.cli_session) or (source.role~='work' and source.role~='review')
      or not require('config.agent.handoff').verified_role(source) then return false,'보고 송신자의 정확한 CLI·역할·부모 관계를 확인할 수 없습니다' end
    sender={owner=source.id,task_id=source.task_id,cli_session=source.cli_session,role=source.role,model=source.model}
  end
  local list=queue(e);local pending=0
  for _,q in ipairs(list) do if q.state=='pending' or q.state=='dispatching' or q.state=='claimed' then pending=pending+1 end end
  if pending>=M.max_pending or #list>=256 then return false,'관리 메시지 보관 한도에 도달했습니다' end
  local id=opts and opts.request_id or require('config.agent.hub').uid()
  if not require('config.agent.hub').valid_id(id) then return false,'잘못된 메시지 ID' end
  for _,q in ipairs(list) do if q.id==id then return false,'이미 소비/등록된 메시지 ID입니다. 재전송하지 않습니다' end end
  local q={id=id,text=text,operation=operation,state='pending',created=os.time(),task_id=e.task_id,role=e.role,model=e.model,cli_session=e.cli_session,sender=sender,on_result=opts and opts.on_result}
  list[#list+1]=q;M.pump(e)
  return true,nil,{id=id,state='accepted',stage='management-queue',vendor_state=q.state,execution='not_observed'}
end
function M.send(e,text,opts) return submit(e,text,opts,'message') end
function M.rename(e,name,callback)
  if vendor(e)~='codex' then return false,'현재 CLI의 실행 중 이름 변경은 지원하지 않습니다' end
  if type(name)~='string' or name:find('[%c]') or #name>512 then return false,'이름 형식 오류' end
  return submit(e,name,{on_result=callback},'name')
end
function M.control(_,_) return false,'자동 정상 종료 미지원: TUI를 정상 종료한 뒤 소유 서버를 종료해야 합니다. 강제 종료하지 않습니다' end
function M.flush_startup(e)
  local s=e.startup
  if not s or s.claimed or not valid(e) then return end
  s.claimed=true;s.state='ready'
  if s.name and vendor(e)=='codex' and e.transport.initial_name~=s.name then M.rename(e,s.name) end
  if s.text and s.text~='' then
    local ok,why,result=M.send(e,s.text,{request_id=s.id});s.message_id=result and result.id;s.state=ok and 'registered' or 'failed';s.error=why
    if not ok then e.status='error';e.status_source='startup-transport';vim.notify('초기 지시 등록 실패: '..tostring(why),vim.log.levels.ERROR) end
  end
  s.text=nil
end
function M.startup(e,text,name)
  if e.startup then return false,'startup already registered' end
  e.startup={text=text,name=name,id=require('config.agent.hub').uid(),state='waiting_transport'}
  M.flush_startup(e);return true
end
-- A single console interrupt is sent only to this launch's hidden server, after its TUI exits.
function M.stop_server(transport)
  local s=transport and transport.server
  if not s or s.stop_sent or s.exit~=nil then return end
  if vim.fn.jobpid(s.job)~=s.pid then
    vim.notify('소유 서버 신원 변경: 종료하지 않았습니다',vim.log.levels.ERROR);return
  end
  s.stop_sent=true
  if vim.fn.chansend(s.job,string.char(3))~=1 then vim.notify('소유 서버 정상 종료 요청 실패: 강제 종료하지 않습니다',vim.log.levels.ERROR) end
end
function M.activate(e)
  if not e.transport or e.transport.vendor~='codex' then return end
  local task,model,expected_role,cli,transport=e.task_id,e.model,e.role,e.cli_session,e.transport
  local role,ok=require('config.agent.handoff').save_role(e,e.role)
  if not ok or role~=e.role then e.status='error';return end
  local identity={instance=require('config.agent.hub').id,owner=e.id,task_id=task,vendor='codex',cli_session=e.cli_session,token=e.event_token}
  local runtime=require('config.agent.policy').installation().runtime
  local env=vim.fn.environ()
  for k in pairs(env) do if k:upper():match('^AGENT_') or k:upper():match('^CODEX_.*_ID$') or k:upper()=='CLAUDE_SESSION_ID'
    or k:upper():match('^CLAUDE_CODE_MESSAGING_') or k:upper():match('^CLAUDE_CODE_SESSION_') then env[k]=nil end end
  env.NVIM=vim.v.servername;env.AGENT_EVENT_INSTANCE=identity.instance;env.AGENT_SESSION_ID=tostring(e.id);env.AGENT_TASK_ID=task
  env.AGENT_SESSION_VENDOR='codex';env.AI_SETTINGS_HOME=runtime;env.AGENT_HUB_HOME=require('config.agent.hub').root()
  vim.system({'node',runtime..'/bin/session-codex.mjs','--check',e.transport.manifest},{text=true,env=env,clear_env=true},vim.schedule_wrap(function(r)
    local success,value=pcall(vim.json.decode,r.stdout or '')
    if require('config.agent.terminal').registry[e.id]~=e or e.exit_code~=nil or e.task_id~=task or e.model~=model
      or e.role~=expected_role or e.cli_session~=cli or e.transport~=transport then return end
    if r.code~=0 or not success or value.cli_session~=e.cli_session or value.mcp_verified~=true then
      e.transport.mcp_verified=false;e.transport.ready=false;e.status='error';e.status_source='transport-identity';vim.notify('Codex UUID/권한/MCP 재확인 실패: 본문을 보내지 않았습니다',vim.log.levels.ERROR);return
    end
    e.transport.mcp_verified=true
    M.receive({operation='ready',identity=identity,role=e.role,model=e.model})
  end))
end
function M.prepare(opts,env)
  if opts.agent~='Codex' and opts.agent~='Claude' then return {cmd=opts.cmd} end
  local saved=opts.saved or {};local role=opts.role or saved.role;local model=opts.model or saved.model
  if not role or not model or (opts.resume and not uuid(saved.id)) then return nil,'재개할 정확한 UUID·역할·모델을 먼저 확인하세요' end
  local runtime=require('config.agent.policy').installation().runtime
  if opts.agent=='Codex' or opts.agent=='Claude' then env.AGENT_HUB_HOME=require('config.agent.hub').root() end
  local request={vendor=opts.agent=='Codex' and 'codex' or 'claude',role=role,model=model,
    owner=tonumber(env.AGENT_SESSION_ID),task_id=env.AGENT_TASK_ID,instance=env.AGENT_EVENT_INSTANCE,cwd=opts.cwd,
    directory=require('config.agent.hub').root()..'/transports',cmd=opts.cmd,executable=vim.fn.exepath(opts.cmd[1]),resume=opts.resume and saved.id or nil}
  if opts.agent=='Codex' and not opts.resume then request.name=opts.session_name or opts.name end
  local result=vim.system({'node',runtime..'/bin/session-message-prepare.mjs'},{text=true,env=env,clear_env=true,stdin=vim.json.encode(request)}):wait()
  local ok,value=pcall(vim.json.decode,result.stdout or '')
  if result.code~=0 or not ok or not value.transport then return nil,'관리 transport 시작 미지원: 역할/모델/버전과 Codex 소유 서버 lifecycle을 확인하세요' end
  env.AGENT_SESSION_ROLE,env.AGENT_SESSION_MODEL=role,model
  if opts.agent=='Codex' then
    local server={buf=vim.api.nvim_create_buf(false,true)}
    value.transport.server=server
    server.job=vim.api.nvim_buf_call(server.buf,function()
      return vim.fn.jobstart(value.server_cmd,{term=true,cwd=opts.cwd,env=env,clear_env=true,on_exit=function(_,code)
        server.exit=code
        value.transport.ready=false;value.transport.mcp_verified=false
        for _,entry in pairs(require('config.agent.terminal').registry) do if entry.transport==value.transport then
          for _,q in ipairs(queue(entry)) do if q.state=='pending' or q.state=='dispatching' or q.state=='claimed' then
            q.state=q.state=='pending' and 'failed' or 'unknown';q.text=nil;q.on_result=nil;q.detail='owned server exited; no redelivery'
          end end
        end end
        local read_ok,exit=pcall(function()return vim.json.decode(table.concat(vim.fn.readfile(vim.fn.fnamemodify(value.manifest,':h')..'/server-exit.json'),'\n'))end)
        server.filesystem_socket_state='unverified';server.endpoint_shutdown_verified=false
        server.normal_exit=code==0 and read_ok and exit.kind=='ai-settings-owned-server-exit' and exit.code==0
          and (exit.signal==nil or exit.signal==vim.NIL) and exit.wrapperPid==server.pid
          and type(exit.childPid)=='number' and exit.childPid>0 and exit.endpoint==value.transport.endpoint
          and exit.filesystemSocketState=='unverified'
        if not server.normal_exit then vim.schedule(function()vim.notify('소유 서버 종료 미확인: 진단 파일과 버퍼를 보존했습니다',vim.log.levels.WARN)end) end
      end})
    end)
    if server.job<=0 then return nil,'소유 Codex 서버 시작 실패' end
    server.pid=vim.fn.jobpid(server.job)
    local init=vim.system({'node',runtime..'/bin/session-codex.mjs','--initialize',value.manifest},{text=true,env=env,clear_env=true}):wait()
    local success,initialized=pcall(vim.json.decode,init.stdout or '')
    if init.code~=0 or not success or not uuid(initialized.cli_session) or not initialized.cmd or initialized.mcp_verified~=true
      or (request.name and initialized.initial_name~=request.name) then
      M.stop_server(value.transport);return nil,'Codex UUID/권한 초기화 실패: 자동 재전송하지 않습니다'
    end
    value.cmd=initialized.cmd;value.transport.expected_cli=initialized.cli_session
    value.transport.initial_name=initialized.initial_name
  end
  if not value.cmd then return nil,'관리 CLI 시작 명령 없음' end
  if opts.agent=='Claude' and not opts.resume then
    if value.role~=role or value.model~=model or value.transport.vendor~='claude' or not uuid(value.transport.expected_cli) then
      return nil,'새 Claude launch 역할·모델·UUID 확인 실패'
    end
    -- The assigned role must exist before either independent native readiness callback can run.
    local assigned,success=require('config.agent.handoff').save_role({agent='Claude',cli_session=value.transport.expected_cli},role)
    if not success or assigned~=role then return nil,'새 Claude 역할 저장 실패: 시작하지 않았습니다' end
  end
  if opts.agent=='Claude' then env.AI_SETTINGS_CLAUDE_LAUNCH=value.manifest end
  if opts.resume then
    local id,success=require('config.agent.handoff').save_role({agent=opts.agent,cli_session=saved.id},role)
    if not success or id~=role then M.stop_server(value.transport);return nil,'재개 역할 확인 실패' end
  end
  return value
end
local function authenticate(o)
  if type(o)~='table' or type(o.identity)~='table' then return end
  local i=o.identity;local e=require('config.agent.terminal').registry[i.owner]
  if not e or e.exit_code~=nil or i.instance~=require('config.agent.hub').id or i.task_id~=e.task_id or i.vendor~=vendor(e)
    or type(e.event_token)~='string' or i.token~=e.event_token or not e.transport then return end
  if i.cli_session and e.cli_session and i.cli_session~=e.cli_session then return end
  return e
end
local function close_claude(e,reason)
  local t=e.transport;t.ready=false;t.model_verified=false;t.model_failed=true;t.model_error=reason
  if e.startup and not e.startup.claimed then e.startup.state='failed';e.startup.error=reason;e.startup.text=nil end
  for _,q in ipairs(queue(e)) do if q.state=='pending' or q.state=='dispatching' or q.state=='claimed' then
    q.state=q.state=='pending' and 'failed' or 'unknown';q.text=nil;q.on_result=nil;q.detail=reason..'; no redelivery'
  end end
  if reason~='session ended' then e.status='error';e.status_source='transport-model' end
end
local function promote_claude(e)
  local t=e.transport
  if not t.inbox_bound or not t.model_verified or t.ready_claimed then return end
  local role,ok=require('config.agent.handoff').save_role(e,e.role)
  if not ok or role~=e.role then close_claude(e,'role mismatch');return end
  t.ready_claimed=true;t.cli_session=e.cli_session;t.ready=true;M.flush_startup(e)
end
function M.receive(o)
  local e=authenticate(o);if not e then return {ok=false,code='identity'} end
  if vendor(e)=='claude' then
    local t=e.transport
    if o.identity.cli_session~=t.expected_cli or o.identity.cli_session~=e.cli_session then return {ok=false,code='identity'} end
    if t.model_failed then return {ok=false,code='ended_or_model_failed'} end
    if o.operation=='end' then close_claude(e,'session ended');return {ok=true} end
    if o.operation=='bind-inbox' or o.operation=='model-attest' or o.operation=='ready' then
      if o.role~=e.role or not require('config.agent.handoff').verified_role(e) then close_claude(e,'role mismatch');return {ok=false,code='role'} end
      if o.operation~='bind-inbox' and o.model~=e.model then close_claude(e,'model mismatch');return {ok=false,code='model'} end
      if not t.model_wait_started then
        t.model_wait_started=os.time()
        local task,cli,role,model=e.task_id,e.cli_session,e.role,e.model
        vim.defer_fn(function()
          if require('config.agent.terminal').registry[e.id]==e and e.transport==t and e.task_id==task and e.cli_session==cli
            and e.role==role and e.model==model and not t.ready and not t.model_failed then close_claude(e,'model timeout') end
        end,M.ttl*1000)
      end
      if not t.ready and os.time()-t.model_wait_started>M.ttl then close_claude(e,'model timeout');return {ok=false,code='model_timeout'} end
      if o.operation=='model-attest' then t.model_verified=true
      else
        if t.inbox_bound then return {ok=false,code='duplicate'} end
        t.inbox_bound=true;if o.operation=='ready' then t.model_verified=true end
      end
      promote_claude(e);return {ok=not t.model_failed}
    end
    if o.operation=='take' and t.inbox_bound and not t.ready then
      if os.time()-t.model_wait_started>M.ttl then close_claude(e,'model timeout');return {ok=false,code='model_timeout'} end
      return {ok=true}
    end
  end
  if o.operation=='ready' then
    if vendor(e)=='codex' and e.transport.mcp_verified~=true then return {ok=false,code='mcp_unverified'} end
    if e.transport.ready_claimed or not uuid(o.identity.cli_session) or e.role~=o.role or e.model~=o.model
      or (e.transport.expected_cli and e.transport.expected_cli~=o.identity.cli_session) then return {ok=false,code='identity'} end
    e.transport.ready_claimed=true;e.cli_session=o.identity.cli_session;e.transport.cli_session=e.cli_session;e.transport.ready=true
    local role,ok=require('config.agent.handoff').save_role(e,e.role)
    if not ok or role~=e.role then e.transport.ready=false;return {ok=false,code='role'} end
    M.flush_startup(e);return {ok=true}
  end
  if not valid(e) or o.identity.cli_session~=e.cli_session then return {ok=false,code='identity'} end
  if o.operation=='end' then
    e.transport.ready=false
    for _,q in ipairs(queue(e)) do if q.state=='pending' or q.state=='dispatching' or q.state=='claimed' then
      q.state=q.state=='pending' and 'failed' or 'unknown';q.text=nil;q.detail='session ended; no redelivery'
    end end
    return {ok=true}
  end
  if o.operation=='take' and vendor(e)=='claude' then
    for _,q in ipairs(queue(e)) do
      if q.state=='pending' then
        if not current(e,q) or os.time()-q.created>M.ttl then
          q.state='failed';q.text=nil;vim.notify('관리 메시지 '..q.id..' 만료/신원 변경: 자동 재전송 없음',vim.log.levels.WARN)
        elseif not require('config.agent.handoff').verified_role(e) then return {ok=false,code='role'}
        else q.state='claimed';return {ok=true,message={id=q.id,text=q.text,operation=q.operation,cli_session=e.cli_session}} end
      end
    end
    return {ok=true}
  end
  for _,q in ipairs(queue(e)) do if q.id==o.message_id and current(e,q) then
    if o.operation=='authorize' and os.time()-q.created>M.ttl then q.state='failed';q.text=nil;return {ok=false,code='expired'} end
    if o.operation=='authorize' and vendor(e)=='codex' and q.state=='dispatching' and o.body_hash==vim.fn.sha256(q.text) and require('config.agent.handoff').verified_role(e) then
      q.state='claimed';return {ok=true,operation=q.operation,cli_session=e.cli_session,endpoint=e.transport.endpoint,executable=e.transport.executable,cwd=e.cwd,body_hash=o.body_hash}
    elseif o.operation=='result' and vendor(e)=='claude' and q.state=='claimed' then
      local details={['inbox-written-no-receipt']=true,['inbox-response-unknown']=true,['inbox-write-unknown']=true,
        ['inbox-response-limit']=true,['inbox-refused']=true,['inbox-held']=true,['inbox-connection-failed']=true,
        ['inbox-peer-end-no-message-receipt']=true,['inbox-peer-close-no-message-receipt']=true,['own-inbox-unavailable']=true}
      settle(e,q,{state=o.state=='failed' and 'failed' or 'unknown',detail=details[o.detail] and o.detail or 'inbox result unverified'});return {ok=true}
    end
  end end
  return {ok=false,code='consumed_or_stale'}
end
_G.AgentMessage64=function(value)
  local ok,o=pcall(function()return vim.json.decode(vim.base64.decode(value))end)
  if not ok then return vim.json.encode({ok=false,code='format'}) end
  local success,result=pcall(M.receive,o)
  return vim.json.encode(success and result or {ok=false,code='protocol'})
end
return M
