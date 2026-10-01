-- 실제 AI CLI 대신 격리된 터미널로 공통 목록과 종료를 검증한다.
local config = vim.fn.stdpath('config')
for _, path in ipairs(vim.fn.glob(config .. '/lua/**/*.lua', false, true)) do assert(loadfile(path), path) end
for _, path in ipairs(vim.fn.glob(config .. '/scripts/*.lua', false, true)) do assert(loadfile(path), path) end
vim.opt.rtp:prepend(config)
local root = vim.fn.tempname() .. '-agent-hub'
vim.env.AGENT_HUB_HOME = root
vim.env.AGENT_HUB_INSTANCE = nil
vim.env.AGENT_HUB_REQUEST = nil
vim.env.AGENT_HUB_MANAGED = nil
local hub = require('config.agent.hub')
hub.setup()
local T = require('config.agent.terminal')
local remote
local function rpc(instance, action, args)
  local result
  hub.rpc(instance, action, args, function(value) result = value end)
  assert(vim.wait(6000, function() return result ~= nil end, 20), 'RPC 완료 시간 초과')
  return result
end
local ok, failure = xpcall(function()
  assert(#hub.instances() == 1, '현재 인스턴스 등록')
  local id = assert(T.spawn({ agent = '테스트', cwd = config, name = '로컬 작업',
    cmd = { vim.fn.exepath('node'), '-e', 'setInterval(()=>{},1000)' } }))
  local entry = T.registry[id]
  assert(entry.task_id and vim.fn.filereadable(entry.note) == 1, '공유 기록 생성')
  assert(T.rename(id, '한글 100% 작업'))
  assert(vim.b[entry.buf].agent_name == '한글 100% 작업')
  assert(not T.rename(id, '  ') and not T.rename(id, '잘못\n된 이름'))
  local terminal_win = vim.api.nvim_get_current_win()
  vim.cmd('tabnew')
  assert(T.focus(id) and vim.api.nvim_get_current_win() == terminal_win, '다른 탭 터미널 이동')
  vim.fn.writefile({ '깨진 JSON' }, root .. '/instances/broken.json')
  assert(#hub.instances() == 1, '손상된 파일 격리')
  local launcher = require('config.agent.launcher')
  local response, launch_error
  local child_pid_file = root .. '/child.pid'
  local js = 'require("fs").writeFileSync(' .. vim.json.encode(child_pid_file) .. ',String(process.pid));setInterval(()=>{},1000)'
  local result = launcher.new({ name = '원격 작업', task_id = entry.task_id, cwd = config, no_ui = true,
    test_cmd = { vim.fn.exepath('node'), '-e', js } }, function(success, data)
      if success then response = data else launch_error = data end
  end)
  assert(not result:find('실패', 1, true), result)
  assert(vim.wait(25000, function() return response or launch_error end, 30), '원격 서버 준비 시간 초과')
  assert(response, tostring(launch_error))
  remote = response
  local snapshot = rpc(remote, 'snapshot', {})
  assert(snapshot.ok and #snapshot.data.entries == 1, '원격 작업 조회')
  local remote_entry = snapshot.data.entries[1]
  assert(remote_entry.id == id and remote.instance ~= hub.id, '같은 터미널 번호의 충돌 방지')
  assert(remote_entry.task_id == entry.task_id and remote_entry.note ~= entry.note, '작업 공유와 작성자 기록 분리')
  assert(rpc(remote, 'rename', { id = remote_entry.id, name = '원격 이름 50%' }).ok)
  assert(rpc(remote, 'snapshot', {}).data.entries[1].name == '원격 이름 50%')
  assert(not rpc(remote, 'rename', { id = 999, name = '종료된 작업' }).ok)
  assert(rpc(remote, 'focus', { id = remote_entry.id }).ok)
  local panel = require('config.agent.panel')
  local before = #vim.api.nvim_list_wins()
  for _ = 1, 3 do panel.open(); vim.wait(100); panel.close() end
  assert(#vim.api.nvim_list_wins() == before, '패널 반복 사용 시 창 유지')
  local dead = rpc({ instance = 'absent', server = '\\\\.\\pipe\\agent-hub-absent' }, 'snapshot', {})
  assert(not dead.ok, '연결 불가 처리')
  local child_pid = tonumber(vim.fn.readfile(child_pid_file)[1])
  assert(child_pid and vim.uv.kill(child_pid, 0), '원격 자식 프로세스 생존')
  assert(rpc(remote, 'stop', {}).ok, '명시적 종료 요청')
  assert(vim.wait(8000, function() return not vim.uv.kill(remote.pid, 0) end, 50), '원격 서버 종료')
  assert(vim.wait(8000, function() return not vim.uv.kill(child_pid, 0) end, 50), '원격 자식 프로세스 종료')
  assert(vim.fn.jobwait({ entry.chan }, 0)[1] == -1, '다른 세션은 유지')
  remote = nil
  local markdown = dofile(config .. '/lua/plugins/markdown.lua')
  local lint_opts = { linters_by_ft = { markdown = { 'markdownlint-cli2' }, lua = { 'selene' } } }
  markdown[1].opts(nil, lint_opts)
  assert(#lint_opts.linters_by_ft.markdown == 0 and lint_opts.linters_by_ft.lua[1] == 'selene')
  local format_opts = { formatters_by_ft = { markdown = { 'prettier', 'markdownlint-cli2', 'markdown-toc' } } }
  markdown[2].opts(nil, format_opts)
  assert(table.concat(format_opts.formatters_by_ft.markdown, ',') == 'prettier,markdown-toc')
  print('통과: 등록·이름 변경·다중 인스턴스·공유 기록·패널·연결 오류·서버와 자식 종료·Markdown 설정')
  print('검증 기록: ' .. root)
end, debug.traceback)
if remote then pcall(rpc, remote, 'stop', {}) end
for _, entry in ipairs(T.entries()) do pcall(vim.fn.jobstop, entry.chan) end
if not ok then error(failure) end
