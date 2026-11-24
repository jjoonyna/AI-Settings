vim.opt.rtp:prepend(vim.fn.getcwd() .. '/nvim')
local T = require('config.agent.terminal')
local H = require('config.agent.hub')
H.id = 'current'
T.registry = { [1] = { id = 1, buf = vim.api.nvim_get_current_buf(), task_id = 'task', agent = 'Codex',
  cli_session = '12345678-1234-1234-1234-123456789abc' },
  [2] = { id = 2, buf = vim.api.nvim_get_current_buf(), task_id = 'task', parent_id = 1 } }
local C = require('config.agent.connection')
local identity = { instance = H.id, owner = 1, task_id = 'task' }
assert(C.resolve(identity).ok)
assert(not C.resolve({ instance = 'other', owner = 1, task_id = 'task' }).ok)
assert(not C.resolve({ instance = H.id, owner = 1, task_id = '' }).ok)
assert(not C.resolve({ instance = H.id, owner = 1, task_id = 'task', cli_session = 'other' }).ok)
local count = 0
_G.AgentUserReview64 = function() count = count + 1; return 'OK' end
local binding = C.resolve(identity).binding
local function invoke(action, payload)
  return C.invoke({ binding = binding, action = action, payload = payload or {} })
end
assert(invoke('preview', {owner=1,task_id='task'}) == 'OK')
assert(invoke('preview', {owner=2,task_id='task'}):match('FAIL:'))
assert(invoke('unknown'):match('FAIL:'))
local function status(owner, task)
  return invoke('status', {owner=owner,task_id=task})
end
assert(not status(2, 'wrong'):match('^%{'))
T.registry[3] = {id=3,buf=vim.api.nvim_get_current_buf(),task_id='other',parent_id=9}
assert(status(3, 'other'):match('FAIL:'))
local snapshot = vim.json.decode(status(2, 'task'))
assert(snapshot.id == 2 and snapshot.task_id == 'task')
assert(snapshot.exit_code == vim.NIL and snapshot.role == vim.NIL and snapshot.report == vim.NIL)
assert(status(1, 'task'):match('^%{'))
assert(C.invoke({binding=vim.tbl_extend('force',binding,{instance='other'}),action='status',payload={owner=2,task_id='task'}}):match('FAIL:'))
local parent = T.registry[1]
parent.role, parent.model, parent.cwd = 'review', 'gpt-6.1-sol', vim.fn.getcwd()
local guard = {role='review',model=parent.model,cwd=parent.cwd}
local handoff = require('config.agent.handoff')
local verified_role = handoff.verified_role
handoff.verified_role = function() return true end
assert(invoke('preview',{owner=1,task_id='task',session_tools=guard}):match('FAIL: session tools role'))
assert(invoke('status',{owner=2,task_id='task',session_tools=guard}):match('FAIL: session tools role'))
parent.role = 'plan'
assert(invoke('preview',{owner=1,task_id='task',session_tools=guard}):match('FAIL: session tools identity'))
guard.role = 'plan'
assert(invoke('preview',{owner=1,task_id='task',path=parent.cwd .. '/README.md',session_tools=guard}):match('FAIL: session tools path'))
assert(invoke('task-complete',{owner=3,task_id='other',parent_id=1,session_tools=guard}):match('FAIL: target relationship'))
handoff.verified_role = verified_role
assert(count == 1)
T.registry[1].task_id = 'changed'
assert(invoke('preview'):match('FAIL:'))
assert(count == 1, 'changed binding must never execute')
T.registry[1].task_id = 'task'
-- Bridge creates a separate task for each child unless explicitly shared.
T.registry[2].task_id = 'child-task'
local stored, sent = 0, 0
H.write = function() stored = stored + 1; return true end
H.publish = function() end
T.send = function() sent = sent + 1; return true end
package.loaded['config.agent.workspace'] = { refresh = function() end }
local handoff = require('config.agent.handoff')
assert(handoff.receive_report({owner=2,parent_id=1,task_id='wrong',text='report'}):match('FAIL:'))
assert(stored == 0 and sent == 0)
assert(handoff.receive_report({owner=2,parent_id=1,task_id='child-task',text='report'}):match('OK'))
assert(stored == 1 and sent == 1)
assert(vim.json.decode(status(2, 'child-task')).report == 'report')
local now = os.time()
local item = {version=1,instance='fresh',server='server',pid=vim.fn.getpid(),updated=now,entries={}}
assert(H.valid_instance(item,now))
assert(not H.valid_instance(vim.tbl_extend('force',item,{updated=now-31}),now))
assert(not H.valid_instance(vim.tbl_extend('force',item,{updated=now+11}),now))
assert(not H.valid_instance(vim.tbl_extend('force',item,{pid=0}),now))
assert(not H.valid_instance(vim.tbl_extend('force',item,{version=2}),now))
assert(H.valid_instance(item,now,function() return nil,'EPERM' end))
assert(not H.valid_instance(item,now,function() return nil,'ESRCH' end))
assert(H.snapshot().entries[1].cli_session == T.registry[1].cli_session)
assert(not vim.json.encode(H.snapshot()):find('event_token'))
print('connection passed')
vim.cmd('qa!')
