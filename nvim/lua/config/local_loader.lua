-- 머신 종속 설정(config/local.lua — gitignore, install.ps1 이 local.lua.tmpl 에서 생성)을 안전하게 읽는다.
-- 파일이 없거나 깨져도 nvim 은 떠야 하므로 pcall 로 감싸고 빈 기본값을 돌려준다.
local M = {}
local cache

function M.get()
  if cache then return cache end
  local ok, L = pcall(require, "config.local")
  if not ok or type(L) ~= "table" then L = {} end
  L.projects = L.projects or {}
  cache = L
  return L
end

--- 테스트용: 캐시를 비운다.
function M.reset() cache = nil; package.loaded["config.local"] = nil end

return M
