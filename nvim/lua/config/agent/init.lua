-- 에이전트 허브 공개 API. 키맵과 사용자 명령을 등록한다.

local menu = require("config.agent.menu")
local terminal = require("config.agent.terminal")
local merge = require("config.agent.merge")

local M = {}

M.menu = menu
M.terminal = terminal
M.merge = merge

--- 터미널 목록에서 하나를 고르게 한다.
--- @param prompt string
--- @param cb fun(entry: table)
local function pick_terminal(prompt, cb)
  local entries = terminal.entries()
  if #entries == 0 then
    vim.notify("띄워둔 에이전트 터미널이 없습니다", vim.log.levels.WARN)
    return
  end
  local labels = {}
  for _, e in ipairs(entries) do
    labels[#labels + 1] = string.format("%s  %s", e.name, e.cwd)
  end
  vim.ui.select(labels, { prompt = prompt }, function(_, idx)
    if idx then
      cb(entries[idx])
    end
  end)
end

--- 목록에서 골라 그 터미널 창으로 이동한다.
function M.list()
  require('config.agent.panel').open()
end

--- 목록에서 골라 프롬프트를 주입한다.
--- @param text string|nil 미리 정해진 본문. 없으면 입력을 받는다.
function M.send(text)
  pick_terminal("보낼 대상", function(e)
    if text and text ~= "" then
      terminal.send(e.id, text)
      vim.notify(e.name .. " 로 보냈습니다")
      return
    end
    vim.ui.input({ prompt = e.name .. " 로 보낼 내용: " }, function(input)
      if input and input ~= "" then
        terminal.send(e.id, input)
        vim.notify(e.name .. " 로 보냈습니다")
      end
    end)
  end)
end

--- Visual 모드 선택 영역을 "파일경로:줄번호" 와 함께 보낸다(설계 §4-2-6-2).
function M.send_selection()
  local s = vim.fn.getpos("'<")
  local e = vim.fn.getpos("'>")
  local lines = vim.api.nvim_buf_get_lines(0, s[2] - 1, e[2], false)
  if #lines == 0 then
    vim.notify("선택 영역이 없습니다", vim.log.levels.WARN)
    return
  end
  local path = vim.fn.expand("%:p")
  local header = string.format("%s:%d-%d", path ~= "" and path or "[No Name]", s[2], e[2])
  M.send(header .. "\n" .. table.concat(lines, "\n"))
end

function M.setup()
  require('config.agent.hub').setup()
  vim.keymap.set('n', '<leader>an', function() require('config.agent.launcher').menu() end, { desc = '새 백그라운드 작업 세션' })
  vim.api.nvim_create_user_command('AgentNew', function() require('config.agent.launcher').menu() end, { desc = '새 유지 세션 열기' })
  vim.api.nvim_create_user_command('AgentDetach', function()
    if not require('config.agent.hub').managed then
      vim.notify('일반 실행 창입니다. 유지 세션에서만 화면을 분리합니다', vim.log.levels.WARN)
      return
    end
    vim.cmd('detach')
  end, { desc = '작업을 유지하고 화면만 닫기' })
  -- 핸드오프 수신부를 먼저 로드해 _G.AgentHandoff 를 등록한다.
  require("config.agent.handoff")

  local map = vim.keymap.set
  map("n", "<leader>aa", M.menu.open, { desc = "에이전트 실행 (메뉴)" })
  map("n", "<leader>al", M.list, { desc = "에이전트 터미널 목록·이동" })
  map("n", "<leader>as", function()
    M.send(nil)
  end, { desc = "에이전트에 프롬프트 보내기" })
  map("x", "<leader>as", function()
    -- '< '> 마크는 Visual 모드를 빠져나와야 확정된다.
    -- vim.cmd("normal! <Esc>") 는 <Esc> 를 리터럴 문자열로 보내 동작하지 않는다.
    local esc = vim.api.nvim_replace_termcodes("<Esc>", true, false, true)
    vim.api.nvim_feedkeys(esc, "nx", false)
    M.send_selection()
  end, { desc = "선택 영역을 에이전트로 보내기" })

  map("n", "<leader>am", merge.open, { desc = "머지 브리핑 생성 (:AgentMerge 1단계)" })

  vim.api.nvim_create_user_command("Agent", function()
    M.menu.open()
  end, { desc = "에이전트 실행 메뉴" })
  vim.api.nvim_create_user_command("AgentList", function()
    M.list()
  end, { desc = "에이전트 터미널 목록" })
  vim.api.nvim_create_user_command("AgentSend", function(a)
    M.send(a.args ~= "" and a.args or nil)
  end, { nargs = "*", desc = "에이전트에 프롬프트 전송" })
  vim.api.nvim_create_user_command("AgentMerge", function()
    merge.open()
  end, { desc = "머지 브리핑 생성 — 1단계만 수행한다" })
end

return M


