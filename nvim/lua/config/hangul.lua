-- 한글 IME 상태에서 Normal·Visual 모드 명령이 동작하게 한다.
-- 원인: IME 가 켜져 있으면 `i` 가 `ㅑ` 로 변환되어 nvim 에 전달되고,
--       nvim 은 `ㅑ` 에 대응하는 명령이 없어 아무 일도 하지 않는다.
--
-- 주의: Insert 모드에는 매핑하지 않는다. 한글을 입력할 수 없게 된다.

local M = {}

-- 두벌식: 영문 키 → 그 키가 만드는 한글 자모
local dubeolsik = {
  -- 윗줄
  q = "ㅂ", w = "ㅈ", e = "ㄷ", r = "ㄱ", t = "ㅅ",
  y = "ㅛ", u = "ㅕ", i = "ㅑ", o = "ㅐ", p = "ㅔ",
  -- 가운뎃줄
  a = "ㅁ", s = "ㄴ", d = "ㅇ", f = "ㄹ", g = "ㅎ",
  h = "ㅗ", j = "ㅓ", k = "ㅏ", l = "ㅣ",
  -- 아랫줄
  z = "ㅋ", x = "ㅌ", c = "ㅊ", v = "ㅍ",
  b = "ㅠ", n = "ㅜ", m = "ㅡ",
}

-- Shift 조합 (대문자 명령용)
local dubeolsik_shift = {
  Q = "ㅃ", W = "ㅉ", E = "ㄸ", R = "ㄲ", T = "ㅆ",
  O = "ㅒ", P = "ㅖ",
}

function M.setup()
  -- n: Normal, x: Visual, o: Operator-pending.
  -- o 가 반드시 있어야 `ㅇㅇ`(dd)·`ㅇㅈ`(dw) 같은 연산자+동작 조합이 성립한다.
  --   첫 ㅇ 이 d 연산자를 시작하면 그 다음 키는 Operator-pending 모드에서 읽히는데,
  --   n·x 매핑만 있으면 거기서 매핑이 풀려 명령이 완성되지 않는다.
  -- Select 모드(s)는 제외한다 — 스니펫 자리표시자를 한글로 채울 때 오작동한다.
  -- Insert 모드도 제외한다 — 한글 입력 자체가 불가능해진다.
  local modes = { "n", "x", "o" }

  for eng, kor in pairs(dubeolsik) do
    vim.keymap.set(modes, kor, eng, { remap = true, desc = "한글 " .. kor .. " → " .. eng })
  end

  for eng, kor in pairs(dubeolsik_shift) do
    vim.keymap.set(modes, kor, eng, { remap = true, desc = "한글 " .. kor .. " → " .. eng })
  end
end

return M
