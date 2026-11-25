-- Persistent private worker bridge. No caller-supplied Lua/function names.
local channel
for line in io.lines() do
  local id
  local ok,value=pcall(function()
    local input=vim.json.decode(line);id=input.id
    if not channel then channel=vim.fn.sockconnect('pipe',assert(vim.env.NVIM),{rpc=true});assert(channel>0) end
    local result=vim.rpcrequest(channel,'nvim_exec_lua',
      'local f=_G.AgentMessage64;if not f then return nil end;return f(...)',
      {vim.base64.encode(vim.json.encode(input.request))})
    if not result then return {ok=false,code='unsupported'} end
    return vim.json.decode(result)
  end)
  io.stdout:write(vim.json.encode({id=id,result=ok and value or {ok=false,code='connection'}})..'\n');io.stdout:flush()
end
if channel then vim.fn.chanclose(channel) end
