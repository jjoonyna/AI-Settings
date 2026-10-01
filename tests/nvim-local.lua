-- 실행: nvim --headless -u NONE -c "set rtp^=nvim" -l tests/nvim-local.lua
-- 저장소 루트에서 실행한다. 실패 시 exit 1.
local function fail(msg) io.stderr:write("FAIL: " .. msg .. "\n"); os.exit(1) end
local function ok(msg) io.stdout:write("ok: " .. msg .. "\n") end

-- 1) local.lua 없음 → 빈 기본값
package.loaded["config.local"] = nil
package.preload["config.local"] = function() error("없음") end
local L = require("config.local_loader").get()
if type(L.projects) ~= "table" then fail("local.lua 없을 때 projects 기본값이 없다") end
ok("local.lua 없음 → 기본값")

-- 2) local.lua 있음 → 프로파일 판정
package.loaded["config.local"] = nil  -- 1)에서 실패한 require 가 남긴 센티널 제거
package.preload["config.local"] = function()
  return { projects = { rbm = { root = "C:/ExRBM/rbm", kind = "java" } } }
end
package.loaded["config.local_loader"] = nil
local ws = require("config.workspace")
if ws.detect_profile("C:\\ExRBM\\rbm\\backend") ~= "rbm" then fail("rbm 하위 경로 판정 실패") end
if ws.detect_profile("C:\\ExRBM\\rbm-hotfix-2.4.5") ~= "rbm" then fail("hotfix worktree 판정 실패") end
if ws.detect_profile("D:\\other") ~= nil then fail("무관 경로가 프로파일에 잡힘") end
ok("workspace.detect_profile")

-- 3) worktree.suggest 가 저장소 이름에서 hotfix 접두를 만든다
local wt = require("config.agent.worktree")
local got = wt.suggest("hotfix/v9.9.9", "C:/ExRBM/rbm")
if got ~= "C:/ExRBM/rbm-hotfix-9.9.9" then fail("hotfix 경로: " .. tostring(got)) end
got = wt.suggest("feat/x", "C:/ExRBM/rbm")
if got ~= "C:/ExRBM/rbm/worktrees/x" then fail("임시 worktree 경로: " .. tostring(got)) end
ok("worktree.suggest")

-- 4) 하드코딩 잔존 검사
local function grep(path, pat)
  local f = assert(io.open(path, "r")); local s = f:read("a"); f:close()
  return s:find(pat, 1, true) ~= nil
end
for _, p in ipairs({ "nvim/lua/config/workspace.lua", "nvim/lua/config/agent/worktree.lua", "nvim/lua/plugins/lsp.lua",
                     "nvim/tests/agent-hub/integration.lua", "nvim/tests/agent-hub/probe-server.lua", "nvim/tests/agent-hub/ui-integration.lua" }) do
  if grep(p, "C:/Users/") or grep(p, "C:/Program Files") or grep(p, "c:/exrbm") or grep(p, "C:/ExRBM") then
    fail("절대경로 잔존: " .. p)
  end
end
ok("하드코딩 없음")
os.exit(0)
