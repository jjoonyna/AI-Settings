vim.opt.rtp:prepend(vim.fn.stdpath('config'))
local P = require('config.agent.policy')
local original = P.installation
P.installation = function() return { mode = 'both', runtime = vim.fn.fnamemodify(vim.fn.stdpath('config'), ':h') .. '/runtime' } end
assert(P.validate({ agent = 'claude', session = 'plan', model = 'opus' }))
assert(P.validate({ agent = 'claude', session = 'work', model = 'sonnet', parent_model = 'opus' }))
assert(P.validate({ agent = 'claude', session = 'review', model = 'haiku', parent_model = 'opus' }))
assert(not P.validate({ agent = 'claude', session = 'work', model = 'fable', parent_model = 'opus' }))
assert(not P.validate({ agent = 'claude', session = 'work', model = 'sonnet', parent_model = 'gpt-6.1-sol' }))
assert(not P.validate({ agent = 'codex', session = 'work', model = 'gpt-6.1-sol', parent_model = 'opus' }))
local cross = P.cross_review_allowed
P.cross_review_allowed = function() return false end
assert(not P.validate({ agent = 'codex', session = 'review', model = 'gpt-6-luna', parent_model = 'opus' }))
P.cross_review_allowed = function() return true end
assert(P.validate({ agent = 'codex', session = 'review', model = 'gpt-6-luna', parent_model = 'opus' }))
assert(not P.validate({ agent = 'codex', session = 'review', model = 'gpt-6-astra', parent_model = 'opus' }))
P.cross_review_allowed = cross
P.installation = function() local v = original(); v.mode = 'codex'; return v end
assert(not P.validate({ agent = 'claude', session = 'plan', model = 'opus' }))
P.installation = original
assert(P.title('review', '로그인 · API') == '리뷰 | 로그인 · API')
local cmd = P.command('claude', 'review', 'sonnet', '리뷰 | 주제')
local joined = table.concat(cmd, ' ')
assert(joined:find('--permission-mode bypassPermissions', 1, true))
local rc = P.report_cmd()
assert(not rc:find('\\', 1, true) and rc:find('/bin/session.mjs report', 1, true))
assert(require('config.agent.handoff').build_prompt({ session = 'work' }):find(rc .. ' -', 1, true))
assert(require('config.agent.handoff').build_prompt({ session = 'review' }):find('임시 파일을 만들지 않는다', 1, true))
assert(not require('config.agent.handoff').build_prompt({ session = 'work' }):find('임시 파일을 만들지 않는다', 1, true))
local bad = { agent = 'codex', session = 'review', model = 'gpt-6-luna', name = 'n', goal = 'g', scope = 's', validation = 'v', prompt = 'p', spec_doc = 'a', plan_doc = 'b', verify_cmds = 'x' }
assert(require('config.agent.handoff').receive(bad):find('verify_cmds', 1, true))
assert(P.command('codex', 'review', 'gpt-6.1-terra')[3] == 'review')
local preview = require('config.agent.plan_preview')
assert(preview.show('docs/specs/nonexistent.md'):find('FAIL:', 1, true))
local handoff = require('config.agent.handoff')
assert(handoff.receive({ agent = 'codex', session = 'work', model = 'gpt-6-luna' }):find('FAIL:', 1, true))
local dir = vim.fn.tempname()
vim.fn.mkdir(dir .. '/docs', 'p')
vim.fn.writefile({ '# Spec' }, dir .. '/docs/spec.md')
vim.fn.writefile({ '# Plan' }, dir .. '/docs/plan.md')
local T = require('config.agent.terminal')
local spawn = T.spawn
local captured
T.registry[88888] = { id = 88888, role = 'plan', model = 'gpt-6.1-sol', agent = 'Codex' }
T.spawn = function(opts) captured = opts; return 99999 end
if vim.v.servername == '' then vim.fn.serverstart() end
local request = { agent = 'codex', session = 'work', model = 'gpt-6-luna', parent_model = 'gpt-6.1-sol', parent_id = 88888,
  name = '테스트 · API', goal = '목표', scope = 'API', validation = '테스트 통과', prompt = '확정 계획 구현',
  spec_doc = dir .. '/docs/spec.md', plan_doc = dir .. '/docs/plan.md', cwd = dir }
assert(handoff.receive(request):find('OK', 1, true))
assert(captured.model == 'gpt-6-luna' and captured.role == 'work')
assert(captured.name == '작업 | 테스트 · API')
assert(captured.env.AGENT_PARENT_ID == '88888')
assert(captured.briefing:find('검증·완료 기준: 테스트 통과', 1, true))
request.parent_model = 'gpt-6-astra'
assert(handoff.receive(request):find('FAIL:', 1, true))
T.spawn = spawn; T.registry[88888] = nil
vim.fn.delete(dir, 'rf')
local received
local send = T.send
T.registry[123456] = { id = 123456, agent = 'Codex' }
T.send = function(id, text) received = { id, text }; return true end
local hub = require('config.agent.hub')
local write = hub.write
hub.write = function() return true end
assert(handoff.receive_report({ parent_id = 123456, text = '검증 완료' }):find('OK', 1, true))
assert(received[1] == 123456 and received[2]:find('검증 완료', 1, true))
T.registry[123456] = nil; T.send = send; hub.write = write
print('통과: 모델 상한·벤더·80% 조건·하위 리뷰·읽기 전용 도구·인계 검증·부모 보고')
