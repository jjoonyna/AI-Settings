vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local T=require('config.agent.terminal');local H=require('config.agent.hub');local M=require('config.agent.message_transport')
H.id='ownership';require('config.agent.handoff').save_role=function(_,r)return r,true end
require('config.agent.handoff').verified_role=function()return true end
local id='11111111-1111-4111-8111-111111111111'
for index,op in ipairs({'ready','bind-inbox'}) do
 local e={id=index,task_id='task',agent='Claude',role='work',model='sonnet',cli_session=id,event_token='event',transport={vendor='claude',expected_cli=id}}
 T.registry[index]=e
 local identity={instance=H.id,owner=index,task_id='task',vendor='claude',cli_session=id,token='event'}
 local owner='22222222-2222-4222-8222-222222222222';local other='33333333-3333-4333-8333-333333333333'
 local function call(operation,hook) return M.receive({operation=operation,identity=identity,role='work',model='sonnet',hook_id=hook}) end
 assert(call(op,owner).ok);assert(call(op,owner).ok,'same hook must recover lost registration response')
 assert(not call(op,other).ok,'different hook is duplicate')
 assert(not call('take',other).ok and not call('result',other).ok and not call('end',other).ok,'duplicate cannot affect owner')
 assert(not e.transport.model_failed);assert(call('take',owner).ok)
 assert(call('session-end').ok and e.transport.model_failed,'SessionEnd closes without hook ownership')
end
print('PASS inbox ownership')
