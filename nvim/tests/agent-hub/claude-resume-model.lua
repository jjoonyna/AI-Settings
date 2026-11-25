vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local T=require('config.agent.terminal');local H=require('config.agent.hub');local M=require('config.agent.message_transport')
H.id='model-test';H.uid=function()return 'initial' end
require('config.agent.handoff').save_role=function(e,r)return r,true end
require('config.agent.handoff').verified_role=function()return true end
local id='11111111-1111-4111-8111-111111111111';local sent=0;local flush=M.flush_startup
M.flush_startup=function(e)assert(e.transport.ready and e.transport.model_verified);sent=sent+1 end
local function fixture(owner)
 local e={id=owner,task_id='task'..owner,agent='Claude',role='plan',model='opus',cli_session=id,event_token='token'..owner,transport={vendor='claude',expected_cli=id,ready=false}};T.registry[owner]=e
 local i={instance=H.id,owner=owner,task_id=e.task_id,vendor='claude',cli_session=id,token=e.event_token}
 local function call(op,model)return M.receive({operation=op,identity=i,role='plan',model=model,hook_id=id})end
 return e,call,i
end
for index,order in ipairs({{'bind-inbox','model-attest'},{'model-attest','bind-inbox'}})do
 local e,call,identity=fixture(index);assert(call(order[1],order[1]=='model-attest' and 'opus' or nil).ok);assert(not e.transport.ready and not e.transport.ready_claimed)
 assert(not M.send(e,'forbidden'))
 if order[1]=='bind-inbox' then assert(call('take').ok and not call('take').message)end
 assert(call(order[2],order[2]=='model-attest' and 'opus' or nil).ok);assert(e.transport.ready and e.transport.ready_claimed and e.transport.model_verified)
 local before=sent;assert(call('model-attest','opus').ok and sent==before);assert(not M.receive({operation='bind-inbox',identity=identity,role='plan',hook_id='22222222-2222-4222-8222-222222222222'}).ok)
 assert(not call('model-attest','haiku').ok);assert(not e.transport.ready);assert(not call('model-attest','opus').ok)
end
local e,call,i=fixture(9);assert(call('bind-inbox').ok);assert(call('end').ok);assert(not call('model-attest','opus').ok)
local old=vim.deepcopy(i);e.event_token='different';assert(not M.receive({operation='model-attest',identity=old,role='plan',model='opus'}).ok)
e,call=fixture(10);assert(call('bind-inbox').ok);e.transport.model_wait_started=os.time()-M.ttl-1;assert(not call('take').ok);assert(not call('model-attest','opus').ok)
e,call=fixture(11);assert(call('ready','opus').ok and e.transport.ready and e.transport.model_verified)
assert(sent==3)
M.flush_startup=flush
vim.fn.chansend=function()error('PTY body/Enter forbidden')end
e,call=fixture(12);assert(M.startup(e,'synthetic initial body'));assert(call('bind-inbox').ok and not e.transport.ready)
assert(#(e.messages or {})==0);assert(call('model-attest','opus').ok);assert(#e.messages==1 and e.startup.claimed)
assert(call('model-attest','opus').ok and #e.messages==1)
local taken=call('take');assert(taken.message.text=='synthetic initial body');assert(not call('take').message and #e.messages==1)
print('PASS Claude two-phase model: both orders, pending no body, current launch, sticky conflict/end/timeout, startup fast path, real startup once/PTY0')
