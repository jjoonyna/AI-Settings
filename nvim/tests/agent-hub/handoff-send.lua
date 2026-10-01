-- 실행(저장소 루트): $env:XDG_CONFIG_HOME = (Get-Location).Path; nvim --headless -u NONE -i NONE -l nvim/tests/agent-hub/handoff-send.lua
--
-- 2026-10-01: Windows 헤드리스 nvim 에서는 `:term`(PTY) 버퍼가 자식 프로세스의 출력을
-- 반영하지 않는 환경 제약이 있어(task-7-report.md 참고), terminal.spawn/실 PTY 를 쓰지 않고
-- wait_ready·send 의 로직만 검증한다. 실제 PTY 경로 확인은 Step 6(설치 뒤 실 nvim)에서 한다.
vim.opt.rtp:prepend(vim.fn.stdpath("config"))
local terminal = require("config.agent.terminal")
local node = vim.fn.exepath("node")

-- 가짜 에이전트: PTY 없는 일반 job. stdin 에서 받은 줄(\r 또는 \n 로 끝남)을
-- GOT:<줄> 로 되쏜다. readline 모듈은 기본으로 \r 를 줄 끝으로 인식하지 않아
-- data 이벤트에서 직접 \r|\n 을 찾는다.
local js = [[
let buf = '';
process.stdin.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.search(/[\r\n]/)) !== -1) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (line.length) process.stdout.write('GOT:' + line + '\n');
  }
});
]]

local output = {}
local job = vim.fn.jobstart({ node, "-e", js }, {
  on_stdout = function(_, data)
    for _, chunk in ipairs(data) do
      if chunk ~= "" then output[#output + 1] = chunk end
    end
  end,
})
assert(job > 0, "가짜 에이전트 job 생성 실패")

local function output_has(pat)
  for _, l in ipairs(output) do
    if l:find(pat, 1, true) then return true end
  end
  return false
end

-- (a) wait_ready: PTY 대신 scratch 버퍼를 레지스트리에 직접 등록하고,
-- 1500ms 뒤 vim.defer_fn 으로 프롬프트 줄을 채워 넣는다.
local buf = vim.api.nvim_create_buf(false, true)
terminal.registry[9001] = { buf = buf, chan = job, started_at = vim.loop.now() }

vim.defer_fn(function()
  vim.api.nvim_buf_set_lines(buf, -1, -1, false, { "❯ " })
end, 1500)

local ready_at
terminal.wait_ready(9001, { pattern = "❯", timeout_ms = 10000, settle_ms = 500 }, function(ready)
  assert(ready, "wait_ready: 준비 감지 실패(10초)")
  ready_at = vim.loop.now()
end)
assert(vim.wait(12000, function() return ready_at ~= nil end, 100), "wait_ready 콜백이 호출되지 않음")

local e9001 = terminal.registry[9001]
assert(ready_at - e9001.started_at >= 1500, "프롬프트가 뜨기 전에 준비로 판정됨")
assert(ready_at - e9001.started_at >= 2000, "settle_ms(500) 이 반영되지 않음")

-- 시간 초과 케이스: 패턴이 끝내 나오지 않는 버퍼.
local buf2 = vim.api.nvim_create_buf(false, true)
terminal.registry[9002] = { buf = buf2, chan = job, started_at = vim.loop.now() }
local timeout_result
terminal.wait_ready(9002, { pattern = "❯", timeout_ms = 1500, interval_ms = 200 }, function(ready)
  timeout_result = ready
end)
assert(vim.wait(5000, function() return timeout_result ~= nil end, 100), "시간 초과 콜백이 호출되지 않음")
assert(timeout_result == false, "패턴이 없는데 ready=true 로 판정됨")
terminal.registry[9002] = nil

-- (b) send: 본문 직후 1000ms(기본) 전에는 Enter 가 가지 않고, 이후 도달해야 한다.
local sent_at = vim.loop.now()
assert(terminal.send(9001, "브리핑 본문 테스트"))
vim.wait(600, function() return false end, 50)
assert(not output_has("GOT:브리핑 본문 테스트"), "Enter 지연(1000ms) 이전에 전송됨")
assert(vim.wait(5000, function() return output_has("GOT:브리핑 본문 테스트") end, 100),
  "본문+Enter 가 에이전트에 도달하지 않음")
assert(vim.loop.now() - sent_at >= 1000, "Enter 지연이 1초 미만")

-- enter_delay_ms 커스텀 옵션.
local sent2_at = vim.loop.now()
assert(terminal.send(9001, "x", { enter_delay_ms = 200 }))
assert(vim.wait(3000, function() return output_has("GOT:x") end, 50),
  "enter_delay_ms 옵션이 적용된 전송이 도달하지 않음")
local delta2 = vim.loop.now() - sent2_at
assert(delta2 >= 200, "enter_delay_ms 가 적용되지 않음(너무 빠름)")
assert(delta2 < 1000, "enter_delay_ms 가 적용되지 않고 기본값(1000ms)으로 보임")

terminal.registry[9001] = nil
pcall(vim.fn.jobstop, job)

-- (c) 제출 확인 → 재시도: chansend/notify 를 스텁으로 바꿔 횟수·페이로드를 검증한다.
-- 입력창에 본문이 계속 남아 있으면 1초 간격으로 최대 max_tries 회(홀수 "\r"/짝수 "\n") 재시도하고,
-- 그래도 남아 있으면 WARN notify 가 한 번 나와야 한다.
do
  local orig_chansend = vim.fn.chansend
  local orig_notify = vim.notify
  local FAKE_CHAN = 424243
  local FAKE_ID = 9003
  local text = "RETRY TEST BODY LINE ONE TWO THREE"

  local calls = {}
  vim.fn.chansend = function(chan, data)
    if chan == FAKE_CHAN then
      if data == "\r" or data == "\n" then
        calls[#calls + 1] = data
      end
      return 0
    end
    return orig_chansend(chan, data)
  end

  local notify_calls = {}
  vim.notify = function(msg, level)
    notify_calls[#notify_calls + 1] = { msg = msg, level = level }
  end

  local buf3 = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf3, 0, -1, false, { "❯ " .. text })
  terminal.registry[FAKE_ID] = { chan = FAKE_CHAN, buf = buf3 }

  assert(terminal.send(FAKE_ID, text, { enter_delay_ms = 1000, prompt = "❯", max_tries = 5 }))

  assert(vim.wait(9000, function() return #notify_calls > 0 end, 100),
    "5회 재시도 뒤 WARN notify 가 호출되지 않음")

  assert(#calls == 5, "재시도 횟수가 5 가 아님: " .. #calls)
  for i, payload in ipairs(calls) do
    local want = (i % 2 == 1) and "\r" or "\n"
    assert(payload == want, string.format("%d번째 재시도 페이로드가 %q 가 아니라 %q", i, want, payload))
  end
  assert(#notify_calls == 1, "WARN notify 가 한 번이 아님: " .. #notify_calls)
  assert(notify_calls[1].level == vim.log.levels.WARN, "notify 레벨이 WARN 이 아님")
  assert(notify_calls[1].msg:find("브리핑이 입력창에 남아 있습니다", 1, true),
    "notify 메시지 내용이 예상과 다름: " .. tostring(notify_calls[1].msg))

  vim.fn.chansend = orig_chansend
  vim.notify = orig_notify
  terminal.registry[FAKE_ID] = nil
end

-- (d) 도중에 입력창의 본문이 지워지면(제출됨) 재시도가 멈춘다.
do
  local orig_chansend = vim.fn.chansend
  local orig_notify = vim.notify
  local FAKE_CHAN = 424244
  local FAKE_ID = 9004
  local text = "RETRY TEST BODY LINE FOUR FIVE SIX"

  local calls = {}
  vim.fn.chansend = function(chan, data)
    if chan == FAKE_CHAN then
      if data == "\r" or data == "\n" then
        calls[#calls + 1] = data
      end
      return 0
    end
    return orig_chansend(chan, data)
  end

  local notify_calls = {}
  vim.notify = function(msg, level)
    notify_calls[#notify_calls + 1] = { msg = msg, level = level }
  end

  local buf4 = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_lines(buf4, 0, -1, false, { "❯ " .. text })
  terminal.registry[FAKE_ID] = { chan = FAKE_CHAN, buf = buf4 }

  -- 2.5초 시점에 입력창을 비운다(제출된 것으로 본다): 1차 재시도(1초)·2차 재시도(2초) 뒤,
  -- 3초 시점의 제출 확인에서 더 이상 pending 이 아니므로 멈춰야 한다.
  vim.defer_fn(function()
    vim.api.nvim_buf_set_lines(buf4, 0, -1, false, { "❯ " })
  end, 2500)

  assert(terminal.send(FAKE_ID, text, { enter_delay_ms = 1000, prompt = "❯", max_tries = 5 }))

  vim.wait(4500, function() return false end, 100)

  assert(#calls == 2, "재시도가 멈추지 않음(또는 너무 일찍 멈춤): " .. #calls)
  assert(#notify_calls == 0, "멈춰야 하는데 WARN notify 가 발생함")

  vim.fn.chansend = orig_chansend
  vim.notify = orig_notify
  terminal.registry[FAKE_ID] = nil
end

print("ok: handoff-send")
os.exit(0)
