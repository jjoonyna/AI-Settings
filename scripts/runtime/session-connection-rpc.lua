local phase = arg[2]
local ok, result = pcall(function()
  local request = vim.json.decode(io.read('*a'))
  local channel = vim.fn.sockconnect('pipe', arg[1], {rpc=true})
  assert(channel > 0, 'ECONNREFUSED')
  local fn = phase == 'resolve' and 'AgentSessionResolve64' or 'AgentSessionInvoke64'
  local success, response = pcall(vim.rpcrequest, channel, 'nvim_exec_lua',
    'local fn = _G[...]; if not fn then return nil end; return fn(select(2, ...))',
    {fn, vim.base64.encode(vim.json.encode(request))})
  vim.fn.chanclose(channel)
  if not success then error(response) end
  if response == nil then return {ok=false,code='protocol'} end
  if phase == 'resolve' then return vim.json.decode(response) end
  return {ok=true,result=response}
end)
if not ok then
  local message = tostring(result):lower()
  local code = (message:find('eperm') or message:find('eacces') or message:find('denied')) and 'permission'
    or (message:find('enoent') or message:find('econnrefused') or message:find('no such file')) and 'unavailable' or 'protocol'
  result = {ok=false,code=code}
end
io.stdout:write(vim.json.encode(result))
io.stdout:flush()
