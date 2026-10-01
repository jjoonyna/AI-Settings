-- 실제 Windows Terminal 화면으로 입력 전환·재접속·계획 검토 창을 검증한다.
local config = vim.fn.stdpath('config')
vim.opt.rtp:prepend(config)
local root = vim.fn.tempname() .. '-hub-ui'
print('검증 위치: ' .. root)
vim.env.AGENT_HUB_HOME = root
vim.env.AGENT_HUB_INSTANCE = nil
vim.env.AGENT_HUB_REQUEST = nil
vim.env.AGENT_HUB_MANAGED = nil
local cwd = root .. '/한글 작업 폴더'
vim.fn.mkdir(cwd, 'p')
local hub = require('config.agent.hub')
hub.setup()
local instance, channel, preview_channel, preview_pid
local function rpc(action, args)
  local response
  hub.rpc(instance, action, args or {}, function(value) response = value end)
  assert(vim.wait(6000, function() return response end, 20), '작업 RPC 시간 초과')
  return response
end
local function remote(code)
  return vim.rpcrequest(channel, 'nvim_exec_lua', code, {})
end
local ok, err = xpcall(function()
  local launch_error
  require('config.agent.launcher').new({ cwd = cwd, name = '화면 검증 작업',
    test_cmd = { vim.fn.exepath('node'), '-e', 'let n=0;setInterval(()=>console.log(++n),200)' },
  }, function(success, value) if success then instance = value else launch_error = value end end)
  assert(vim.wait(25000, function() return instance or launch_error end, 30), '화면 시작 시간 초과')
  assert(instance, tostring(launch_error))
  channel = vim.fn.sockconnect('pipe', instance.server, { rpc = true })
  assert(channel > 0)
  assert(vim.wait(8000, function() return remote('return vim.fn.exists(":AgentList")') == 2 end, 50), 'LazyVim 초기화')
  local first = rpc('snapshot').data
  assert(first.uis == 1 and #first.entries == 1)
  local id = first.entries[1].id
  assert(rpc('focus', { id = id }).ok)
  vim.rpcrequest(channel, 'nvim_input', '<C-\\><C-n>')
  vim.wait(200)
  vim.rpcrequest(channel, 'nvim_input', '<C-w>')
  assert(vim.wait(2500, function() return remote('return vim.api.nvim_get_mode().mode') == 't' end, 30), 'Ctrl+w 터미널 입력 진입')
  vim.rpcrequest(channel, 'nvim_input', '<C-q>')
  assert(vim.wait(2000, function() return remote('return vim.api.nvim_get_mode().mode'):sub(1, 1) == 'n' end, 30), 'Ctrl+q 터미널 입력 탈출')
  remote('vim.cmd("enew")')
  vim.rpcrequest(channel, 'nvim_input', '<C-w>')
  assert(vim.wait(2500, function() return remote('return vim.api.nvim_get_mode().mode') == 'i' end, 30), 'Ctrl+w 문서 입력 진입')
  vim.rpcrequest(channel, 'nvim_input', '<C-q>')
  assert(vim.wait(2000, function() return remote('return vim.api.nvim_get_mode().mode'):sub(1, 1) == 'n' end, 30), 'Ctrl+q 문서 입력 탈출')
  remote('vim.api.nvim_buf_set_lines(0,0,-1,false,{"저장 전"})')
  assert(not rpc('stop').ok, '미저장 버퍼 종료 방지')
  remote('vim.bo.modified=false')
  remote('vim.cmd.edit(vim.fn.getcwd() .. [[/문서.md]])')
  vim.wait(500)
  local markdown_state = remote([[return { lint=require('lint').linters_by_ft.markdown,
    marksman=require('lazy.core.plugin').values(require('lazy.core.config').plugins['nvim-lspconfig'],'opts',false).servers.marksman ~= nil, error=vim.v.errmsg }]])
  print('Markdown 설정: ' .. vim.json.encode(markdown_state))
  assert(#markdown_state.lint == 0 and markdown_state.marksman, 'Markdown 형식 검사 끄기·링크 검사 유지')
  remote('for _,ui in ipairs(vim.api.nvim_list_uis()) do vim.fn.chanclose(ui.chan) end')
  assert(vim.wait(3000, function() return rpc('snapshot').data.uis == 0 end, 50))
  local connected, attach_error
  require('config.agent.launcher').attach(rpc('snapshot').data, function(success, value) connected=success; attach_error=value end)
  assert(vim.wait(10000, function() return connected ~= nil end, 30))
  assert(connected, tostring(attach_error))
  local again = rpc('snapshot').data
  assert(again.pid == first.pid and again.entries[1].id == id, '동일 서버·터미널 재접속')
  local plan_dir = cwd .. '/docs/superpowers/plans'
  vim.fn.mkdir(plan_dir, 'p')
  local plan = plan_dir .. '/새 계획.md'
  vim.fn.writefile({ '# 새 계획', '', '상태: 검토용 문서', '', '한글 경로 자동 표시 검증' }, plan)
  local claim_path = root .. '/previews/' .. vim.fn.sha256(vim.fn.fnamemodify(plan, ':p'):gsub('\\','/'):lower()) .. '.json'
  assert(vim.wait(16000, function() return hub.read(claim_path) end, 100), '새 계획 자동 표시')
  local claim = hub.read(claim_path)
  assert(vim.wait(6000, function()
    local worked, c = pcall(vim.fn.sockconnect, 'pipe', claim.server, { rpc = true })
    if worked and c > 0 then preview_channel = c; return true end
  end, 100), '계획 검토 창 연결')
  assert(vim.wait(5000, function()
    return vim.rpcrequest(preview_channel, 'nvim_exec_lua', 'return vim.fn.maparg("<C-d>","n")', {}) ~= ''
  end, 50), '계획 검토 창 초기화')
  local view = vim.rpcrequest(preview_channel, 'nvim_exec_lua', [[return {
    file=vim.api.nvim_buf_get_name(0), readonly=vim.bo.readonly, modifiable=vim.bo.modifiable,
    pid=vim.fn.getpid(), mapping=vim.fn.maparg('<C-d>','n'), theme=vim.g.colors_name }]], {})
  print('계획 검토 창: ' .. vim.json.encode(view))
  preview_pid = view.pid
  assert(view.readonly and not view.modifiable and view.mapping:find('qa!',1,true), '계획 검토 전용 모드')
  assert(view.theme == 'catppuccin-mocha', '검토 창 테마')
  vim.rpcrequest(preview_channel, 'nvim_input', '<C-d>')
  assert(vim.wait(4000, function() return not vim.uv.kill(preview_pid, 0) end, 40), 'Ctrl+d 검토 창 종료')
  assert(rpc('snapshot').ok, '계획 창 종료 후 작업 유지')
  assert(rpc('stop').ok)
  assert(vim.wait(8000, function() return not vim.uv.kill(instance.pid,0) end, 50))
  print('통과: 실제 화면·한글 경로·Ctrl+w/q·미저장 종료 방지·동일 작업 재접속·새 계획 자동 표시·Ctrl+d')
  print('검증 기록: ' .. root)
  instance = nil
end, debug.traceback)
if instance then
  if channel then pcall(remote, 'for _,b in ipairs(vim.api.nvim_list_bufs()) do vim.bo[b].modified=false end') end
  pcall(rpc, 'stop')
end
if preview_channel then pcall(vim.rpcnotify, preview_channel, 'nvim_command', 'qa!') end
for _, leftover in ipairs(hub.instances()) do
  if leftover.managed then
    local done
    hub.rpc(leftover, 'stop', {}, function() done = true end)
    vim.wait(4000, function() return done end, 20)
  end
end
if not ok then error(err) end





