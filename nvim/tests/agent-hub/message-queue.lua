vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local T=require('config.agent.terminal');local H=require('config.agent.hub');local M=require('config.agent.message_transport')
H.id='instance';H.valid_id=function(x)return type(x)=='string' and x:match('^[%w-]+$')end;local seq=0;H.uid=function()seq=seq+1;return 'message-'..seq end
require('config.agent.handoff').save_role=function(e,role)return role,true end
require('config.agent.handoff').verified_role=function()return true end
local id='11111111-1111-4111-8111-111111111111'
local e={id=7,agent='Codex',model='gpt-6.1-sol',role='work',task_id='task',cli_session=id,event_token='synthetic',cwd=vim.fn.getcwd(),transport={vendor='codex',ready=true,cli_session=id,endpoint='unix://synthetic',executable='synthetic'}}
T.registry[7]=e;local callbacks={}
M.execute=function(_,q,cb)callbacks[#callbacks+1]={q=q,cb=cb}end
local identity={owner=7,instance='instance',task_id='task',vendor='codex',cli_session=id,token='synthetic'}
local ok,_,receipt=M.send(e,'body',{request_id='exact-message'});assert(ok and receipt.stage=='management-queue' and receipt.execution=='not_observed')
assert(not M.send(e,'body',{request_id='exact-message'}))
local claim={operation='authorize',identity=identity,message_id='exact-message',body_hash=vim.fn.sha256('body')}
assert(M.receive(claim).ok);assert(not M.receive(claim).ok,'second worker must not redeliver')
callbacks[1].cb({state='unknown',detail='lost'});assert(e.messages[1].state=='unknown' and e.messages[1].text==nil)
assert(not M.send(e,'again',{request_id='exact-message'}))
local wrong=vim.deepcopy(identity);wrong.task_id='reused';assert(not M.receive({operation='take',identity=wrong}).ok)
e.transport.ready=false;assert(not M.send(e,'not ready'))
M.startup(e,'startup','name');assert(#callbacks==1,'startup waits for transport not a screen')
local ready={operation='ready',identity=identity,role=e.role,model=e.model}
assert(not M.receive(ready).ok,'authenticated ready alone cannot bypass the actual MCP proof')
e.transport.mcp_verified=true -- Synthetic fixture stands in for the completed local native check.
assert(M.receive(ready).ok);assert(#callbacks==2 and callbacks[2].q.operation=='name')
callbacks[2].cb({state='accepted'});assert(#callbacks==3 and callbacks[3].q.text=='startup')
callbacks[3].cb({state='accepted',receipt='vendor-queued'});assert(e.messages[3].receipt=='vendor-queued')
assert(M.send(e,'expired body',{request_id='late-worker'}));e.messages[4].created=os.time()-M.ttl-1
assert(not M.receive({operation='authorize',identity=identity,message_id='late-worker',body_hash=vim.fn.sha256('expired body')}).ok,'worker authorization must enforce TTL too')
callbacks[4].cb({state='failed'})
assert(not M.receive(ready).ok,'duplicate readiness must not repeat startup')
assert(M.receive({operation='end',identity=identity}).ok and not e.transport.ready)
assert(not M.receive(ready).ok,'ended launch must not be rearmed')
local c={id=8,agent='Claude',model='sonnet',role='work',task_id='claude-task',cli_session=id,event_token='synthetic-c',
  transport={vendor='claude',ready=true,model_verified=true,expected_cli=id,cli_session=id}}
T.registry[8]=c
for i=1,16 do assert(M.send(c,'body-'..i,{request_id='c-'..i})) end
assert(not M.send(c,'overflow',{request_id='overflow'}),'saturated queue must reject')
local ci={owner=8,instance='instance',task_id='claude-task',vendor='claude',cli_session=id,token='synthetic-c'}
c.messages[1].created=os.time()-M.ttl-1
local taken=M.receive({operation='take',identity=ci});assert(taken.ok and taken.message.id=='c-2' and c.messages[1].state=='failed')
assert(M.receive({operation='result',identity=ci,message_id='c-2',state='accepted',detail='SECRET_PIPE'}).ok)
assert(c.messages[2].state=='unknown' and not c.messages[2].detail:find('SECRET',1,true),'inbox write alone cannot become accepted; raw details are discarded')
assert(not M.receive({operation='result',identity=ci,message_id='c-2',state='accepted'}).ok)
c.role='review';assert(not M.receive({operation='take',identity=ci}).message,'role change invalidates queued bodies')
local p={id=10,agent='Claude',role='plan',model='sonnet',task_id='p',cli_session=id,event_token='p-token',transport={vendor='claude',ready=true,model_verified=true,expected_cli=id,cli_session=id}}
local child={id=11,agent='Codex',role='work',model='gpt-6.1-sol',task_id='child',parent_id=10}
T.registry[10]=p;T.registry[11]=child
assert(not M.send(p,'report',{sender={owner=11,task_id='child'}}),'unbound sender cannot dispatch a stored report')
child.cli_session='22222222-2222-4222-8222-222222222222'
assert(M.send(p,'report',{request_id='report-test',sender={owner=11,task_id='child',cli_session=child.cli_session}}))
child.task_id='reused'
local pi={owner=10,instance='instance',task_id='p',vendor='claude',cli_session=id,token='p-token'}
assert(not M.receive({operation='take',identity=pi}).message,'reused sender task invalidates report before provider dispatch')
print('PASS message-queue: atomic identity/claim, unknown/no replay, API readiness startup once, metadata separate, end invalidation')
