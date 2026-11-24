vim.opt.rtp:prepend(vim.fn.getcwd()..'/nvim')
local T=require('config.agent.terminal');local H=require('config.agent.hub');local C=require('config.agent.connection')
H.id='message-status'
local a={id=1,agent='Codex',task_id='parent',role='plan',cli_session='11111111-1111-4111-8111-111111111111',messages={{id='report-id',state='unknown',text='PRIVATE_BODY',token='PRIVATE_TOKEN'}}}
local b={id=2,agent='Claude',task_id='child',parent_id=1,role='work',cli_session='22222222-2222-4222-8222-222222222222',latest_report='saved report',report_delivery={state='management-queue',message_id='report-id'}}
T.registry={[1]=a,[2]=b};T.entries=function()return {a,b}end
local binding={server=vim.v.servername,instance=H.id,owner=1,task_id='parent',vendor='codex',cli_session=a.cli_session}
local output=C.invoke({binding=binding,action='status',payload={owner=2,task_id='child'}})
local result=vim.json.decode(output)
assert(result.report=='saved report' and result.report_delivery.state=='unknown' and result.report_delivery.execution=='not_observed')
assert(not output:find('PRIVATE',1,true),'status must not expose queued body/token')
binding.owner=2;binding.task_id='child';binding.vendor='claude';binding.cli_session=b.cli_session
assert(C.invoke({binding=binding,action='status',payload={owner=1,task_id='parent'}}):find('FAIL:',1,true),'child must not gain parent status access')
print('PASS message-status: optional delivery state, report receipt distinct, no body/token, unchanged target relationship')
