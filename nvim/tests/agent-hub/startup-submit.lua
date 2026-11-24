vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local T=require('config.agent.terminal');local H=require('config.agent.hub');local M=require('config.agent.message_transport')
H.id='startup';local seq=0;H.uid=function()seq=seq+1;return 'startup-'..seq end;H.valid_id=function()return true end
local handoff=require('config.agent.handoff');handoff.save_role=function(e,role)return role,true end;handoff.verified_role=function()return true end
local id='11111111-1111-4111-8111-111111111111'
local e={id=7,agent='Codex',role='review',model='gpt-6.1-sol',task_id='task',cli_session=id,event_token='synthetic',transport={vendor='codex',expected_cli=id,ready=false}}
T.registry[7]=e
local calls={};M.execute=function(_,q,cb)calls[#calls+1]={q=q,cb=cb}end
vim.fn.chansend=function()error('management must never send body/Enter to PTY')end
local text='역할: review\n'..string.rep('가',1914)
assert(M.startup(e,text,'리뷰 | startup'));assert(#calls==0,'wait for exact API readiness')
local ready={operation='ready',identity={instance=H.id,owner=7,task_id='task',vendor='codex',cli_session=id,token='synthetic'},role=e.role,model=e.model}
assert(not M.receive(ready).ok,'native MCP readiness proof is required before startup')
e.transport.mcp_verified=true -- Synthetic native-proof fixture, not provider evidence.
assert(not M.receive(vim.tbl_extend('force',ready,{model='wrong'})).ok)
assert(M.receive(ready).ok);assert(#calls==1 and calls[1].q.operation=='name')
calls[1].cb({state='accepted'});assert(#calls==2 and calls[2].q.text==text and calls[2].q.operation=='message')
calls[2].cb({state='accepted',receipt='queue-receipt'});assert(e.startup.claimed and e.startup.text==nil)
assert(not M.receive(ready).ok);M.flush_startup(e);assert(#calls==2,'initial instruction only once')
assert(not M.startup(e,'duplicate'))
local context=require('config.agent.launcher').context({name='plan',cwd='project',task_id='task',note='note'},{agent='codex'})
assert(context:find('ai_settings_sessions',1,true))
assert(require('config.agent.launcher').context({name='plan',cwd='project',task_id='task',note='note'},{agent='claude'}):find('ai_settings_sessions',1,true))
print('PASS startup-submit: exact API readiness, metadata separate, body once, no PTY/Enter, launcher guidance')

local before=#calls
local named={id=8,agent='Codex',role='work',model=e.model,task_id='named',cli_session=id,event_token='synthetic',
  transport={vendor='codex',expected_cli=id,cli_session=id,ready=true,mcp_verified=true,initial_name='작업 | named'}}
T.registry[8]=named
assert(M.startup(named,'second body','작업 | named'))
assert(#calls==before+1 and calls[#calls].q.operation=='message','known successful initial name must not be sent twice')
calls[#calls].cb({state='accepted'})
assert(named.startup.text==nil)
print('PASS initialized title: no duplicate metadata mutation, startup body once')
