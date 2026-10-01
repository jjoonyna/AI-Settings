-- 별도 프로세스에서 RPC 응답을 기다려 편집 화면이 멈추지 않게 한다.
local ok, result = pcall(function()
  local request = vim.json.decode(io.read('*a'))
  local channel = vim.fn.sockconnect('pipe', assert(arg[1]), { rpc = true })
  assert(channel > 0, '대상 Neovim에 연결할 수 없습니다')
  local response = vim.rpcrequest(channel, 'nvim_exec_lua',
    'return require("config.agent.hub").dispatch(...)', { request })
  vim.fn.chanclose(channel)
  return response
end)
io.stdout:write(vim.json.encode(ok and result or { ok = false, error = tostring(result) }))
io.stdout:flush()
