// agent-done.js — 작업 세션 자동 종료 훅
//
// 작업 세션이 완료 보고 마지막 줄에 [AGENT-DONE] 을 찍으면 이 스크립트가 세션을 닫는다.
//   - Claude Code: settings.json hooks.Stop 에서 호출(stdin JSON: transcript_path, cwd)
//   - Codex:       config.toml notify 에서 호출(인자 --codex, argv 마지막이 JSON: last-assistant-message)
// 닫는 방법:
//   - nvim 터미널 안($NVIM 있음) → nvim 에 AgentDone({cwd}) 를 원격 호출해 /exit 를 보내고 창을 닫게 한다
//   - 그 밖($NVIM 없음)          → 조상 프로세스 중 에이전트 CLI(claude/codex) 를 찾아 종료한다
// 마커가 없으면 아무 것도 하지 않는다. 계획·조사 세션은 마커를 찍지 않으므로 영향이 없다.

const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');

const MARKER = '[AGENT-DONE]';
const isCodex = process.argv.includes('--codex');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Claude 트랜스크립트(JSONL)에서 마지막 assistant 텍스트를 꺼낸다
function lastAssistantText(transcriptPath) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return ''; }
  const lines = raw.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    if (obj.type !== 'assistant' || !obj.message) continue;
    const content = obj.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    }
  }
  return '';
}

// 이 훅의 조상 프로세스 PID 목록(자기 자신 포함, 위로 최대 12단계). nvim 이 터미널 잡 PID 와 대조해
// "마커를 찍은 바로 그 세션"을 고른다 — 같은 cwd 의 세션이 여럿(계획·작업이 같은 폴더)이어도 엉뚱한 창을 닫지 않는다
function ancestorPids() {
  const ps = [
    '$p = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"',
    '$out = @()',
    'for ($i = 0; $i -lt 12 -and $p; $i++) {',
    '  $out += $p.ProcessId',
    '  $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId)',
    '}',
    '$out -join ","',
  ].join('; ');
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 10000 });
  return (r.stdout || '').trim().split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
}

function notifyNvim(cwd) {
  const server = process.env.NVIM;
  const pids = ancestorPids();
  const cwdArg = cwd.replace(/\\/g, '/').replace(/'/g, "''");
  // pids 가 우선, cwd 는 후보가 하나일 때만 쓰는 폴백(terminal.lua M.done)
  const arg = `v:lua.AgentDone({'cwd': '${cwdArg}', 'pids': [${pids.join(', ')}]})`;
  const r = spawnSync('nvim', ['--headless', '--server', server, '--remote-expr', arg], { encoding: 'utf8', timeout: 15000 });
  return (r.stdout || '').trim();
}

// 조상 프로세스를 거슬러 올라가 에이전트 CLI 를 찾아 종료한다(Windows)
function killAgentAncestor() {
  const ps = [
    '$p = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"',
    'for ($i = 0; $i -lt 8 -and $p; $i++) {',
    '  $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId)',
    '  if ($p -and $p.CommandLine -match "claude|codex" -and $p.Name -notmatch "^(nvim|WindowsTerminal|pwsh|powershell|cmd|bash)") {',
    '    Stop-Process -Id $p.ProcessId -Force; Write-Output ("killed " + $p.ProcessId + " " + $p.Name); break',
    '  }',
    '}',
  ].join('; ');
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 10000 });
  return (r.stdout || '').trim();
}

function main() {
  let text = '';
  let cwd = process.cwd();
  if (isCodex) {
    const json = process.argv[process.argv.length - 1];
    try {
      const o = JSON.parse(json);
      if (o.type && o.type !== 'agent-turn-complete') return;
      text = o['last-assistant-message'] || '';
      if (o.cwd) cwd = o.cwd;
    } catch { return; }
  } else {
    let o;
    try { o = JSON.parse(readStdin()); } catch { return; }
    if (o.stop_hook_active) return; // 훅이 이어 붙인 턴에서는 재진입하지 않는다
    if (o.cwd) cwd = o.cwd;
    text = lastAssistantText(o.transcript_path);
  }
  if (!text.includes(MARKER)) return;
  // 작업 세션만 닫는다 — 계획 세션이 마커 문자열을 인용해도 닫히지 않게(2026-09-21 사고).
  // nvim 핸드오프·메뉴·런처가 작업 세션에 AGENT_SESSION_ROLE=work 를 넣어 준다.
  // nvim 밖에서 직접 띄우는 작업 세션은 실행 전에 이 변수를 설정해야 자동 종료가 동작한다.
  if (process.env.AGENT_SESSION_ROLE !== 'work') return;

  if (process.env.NVIM) {
    notifyNvim(cwd);
  } else {
    killAgentAncestor();
  }
}

main();
