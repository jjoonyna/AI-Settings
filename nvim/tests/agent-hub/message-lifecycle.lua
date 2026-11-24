vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local T=require('config.agent.terminal');local H=require('config.agent.hub');local M=require('config.agent.message_transport')
H.id='lifecycle';local root=vim.fn.tempname();vim.fn.mkdir(root,'p');H.root=function()return root end
require('config.agent.policy').installation=function()return {runtime=root}end
local handoff=require('config.agent.handoff');handoff.save_role=function(e,role)return role,true end;handoff.verified_role=function()return true end
local id='11111111-1111-4111-8111-111111111111'
local manifest=root..'/launch.message.json';vim.fn.writefile({vim.json.encode({directory=root,role='work'})},manifest)
local writes,started,checks={},0,{}
local fake={role='work',model='gpt-6.1-sol',manifest=manifest,server_cmd={'node','owned-server','--serve',manifest},transport={vendor='codex',ready=false,manifest=manifest,endpoint='unix://'..root..'/control.sock'}}
vim.fn.jobstart=function(cmd,opts)
  started=started+1;assert(cmd[2]=='owned-server' and opts.term and opts.clear_env,'hidden owned ConPTY only')
  assert(vim.api.nvim_get_current_buf()~=0);checks.exit=opts.on_exit;return 71
end
vim.fn.jobpid=function(job)assert(job==71);return 555 end
vim.fn.chansend=function(job,text)assert(job==71,'never sends to AI TUI');writes[#writes+1]=text;return #text end
vim.fn.jobstop=function()error('forced server stop forbidden')end
local lose_init=false;local mcp_verified=true
vim.system=function(cmd,opts,cb)
  if cmd[2]:find('session-message-prepare',1,true)then return {wait=function()return {code=0,stdout=vim.json.encode(fake)}end}end
  if cmd[3]=='--initialize'then return {wait=function()return lose_init and {code=1} or {code=0,stdout=vim.json.encode({cli_session=id,mcp_verified=mcp_verified,cmd={'codex-native','--remote',fake.transport.endpoint,'resume',id}})}end}end
  assert(cmd[3]=='--check');checks.complete=cb;return {}
end
local env={AGENT_SESSION_ID='9',AGENT_TASK_ID='task',AGENT_EVENT_INSTANCE=H.id}
local prepared=assert(M.prepare({agent='Codex',cmd={'codex'},role='work',model='gpt-6.1-sol',cwd=vim.fn.getcwd()},env))
assert(started==1 and prepared.cmd[#prepared.cmd]==id and not prepared.transport.ready and #writes==0)
assert(prepared.transport.launch_env==nil,'registry must not retain the full inherited environment')
local e={id=9,task_id='task',agent='Codex',model='gpt-6.1-sol',role='work',cli_session=id,event_token='synthetic',transport=prepared.transport}
T.registry[9]=e;M.activate(e);assert(not e.transport.ready)
local sent=0;M.execute=function()sent=sent+1 end;assert(M.startup(e,'must wait for MCP'))
checks.complete({code=0,stdout=vim.json.encode({cli_session=id,mcp_verified=false})});vim.wait(20,function()return false end)
assert(e.status=='error' and not e.transport.ready and sent==0 and #writes==0,'post-TUI MCP failure must not dispatch startup')
assert(e.exit_code==nil and not e.transport.server.stop_sent,'post-TUI MCP failure preserves AI TUI and its live owned server')
M.activate(e)
e.model='changed';checks.complete({code=0,stdout=vim.json.encode({cli_session=id,mcp_verified=true})});vim.wait(20,function()return false end)
assert(not e.transport.ready,'stale model cannot accept a readiness response')
e.model='gpt-6.1-sol';M.activate(e)
checks.complete({code=0,stdout=vim.json.encode({cli_session=id,mcp_verified=true})});assert(vim.wait(1000,function()return e.transport.ready end))
assert(sent==1,'verified MCP releases startup once');M.flush_startup(e);assert(sent==1)
M.stop_server(e.transport);M.stop_server(e.transport)
assert(#writes==1 and writes[1]==string.char(3),'owned server gets one console interrupt, no body or Enter')
vim.fn.writefile({vim.json.encode({code=0,socketStillExists=false})},root..'/server-exit.json')
checks.exit(71,0);assert(not e.transport.server.normal_exit,'stat false cannot prove socket deletion or exact owned native termination')
vim.fn.writefile({vim.json.encode({kind='ai-settings-owned-server-exit',wrapperPid=555,childPid=777,endpoint=fake.transport.endpoint,code=0,signal=vim.NIL,filesystemSocketState='unverified'})},root..'/server-exit.json')
checks.exit(71,0);assert(e.transport.server.normal_exit and not e.transport.ready,'exact owned process exit invalidates transport readiness')
assert(e.transport.server.filesystem_socket_state=='unverified' and e.transport.server.endpoint_shutdown_verified~=true,'normal process exit must not claim filesystem deletion')
-- Isolated callback payload cases; this test has no actual native server.
local good={kind='ai-settings-owned-server-exit',wrapperPid=555,childPid=777,endpoint=fake.transport.endpoint,code=0,signal=vim.NIL,filesystemSocketState='unverified'}
for _,change in ipairs({{wrapperPid=556},{childPid=0},{endpoint='wrong'},{code=1},{signal='SIGTERM'},{filesystemSocketState='absent'}})do
  vim.fn.writefile({vim.json.encode(vim.tbl_extend('force',good,change))},root..'/server-exit.json');checks.exit(71,0)
  assert(not e.transport.server.normal_exit,'wrong owned process/endpoint/termination evidence must be rejected')
end
vim.fn.writefile({vim.json.encode(good)},root..'/server-exit.json');checks.exit(71,1);assert(not e.transport.server.normal_exit,'abnormal wrapper exit cannot be normal')
lose_init=true
local value,err=M.prepare({agent='Codex',cmd={'codex'},role='work',model='gpt-6.1-sol',cwd=vim.fn.getcwd()},env)
assert(not value and err and #writes==2,'failed initialization cleans only its owned server once')
lose_init=false;mcp_verified=false
value,err=M.prepare({agent='Codex',cmd={'codex'},role='work',model='gpt-6.1-sol',cwd=vim.fn.getcwd()},env)
assert(not value and err and #writes==3,'pre-TUI MCP failure cleans its owned server without a TUI/body/Enter')
mcp_verified=true
lose_init=false;handoff.save_role=function()return nil,false end
value,err=M.prepare({agent='Codex',cmd={'codex','resume',id},resume='resume',saved={id=id,role='work',model='gpt-6.1-sol'},cwd=vim.fn.getcwd()},env)
assert(not value and err and #writes==4,'failed saved-role confirmation must clean its owned server')
vim.fn.delete(root,'rf')
print('PASS message-lifecycle: hidden owned ConPTY, UUID/MCP readiness, one normal interrupt, exact process exit, filesystem deletion unverified, failed-init cleanup')
