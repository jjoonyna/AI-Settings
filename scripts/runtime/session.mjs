import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolveSessionModel } from './session-model.mjs';
const [action, argument] = process.argv.slice(2);
const server = action === 'report' ? process.env.AGENT_PARENT_SERVER : process.env.NVIM;
if (!server) { console.error('Neovim server is unavailable; start a managed session.'); process.exit(1); }
let fn, payload;
try {
  if (action === 'handoff') {
    fn = 'AgentHandoff64'; payload = JSON.parse(fs.readFileSync(argument, 'utf8').replace(/^\uFEFF/, ''));
    payload.resolved_session = resolveSessionModel(process.env);
    payload.parent_model ||= process.env.AGENT_SESSION_MODEL;
    payload.parent_agent ||= process.env.AGENT_SESSION_VENDOR;
    payload.parent_id ||= Number(process.env.AGENT_SESSION_ID) || undefined;
    payload.parent_server ||= process.env.NVIM;
  }
  else if (action === 'preview') { fn = 'AgentUserReview64'; payload = { path: argument }; }
  else if (action === 'report') {
    const text = fs.readFileSync(argument === '-' ? 0 : argument, 'utf8');
    if (text.includes('??') && !/[^\u0000-\u007f]/.test(text)) throw new Error('인코딩 손상 의심: PowerShell은 $OutputEncoding을 UTF-8로 설정 후 재전송');
    fn = 'AgentReceiveReport64'; payload = { parent_id: Number(process.env.AGENT_PARENT_ID), from: process.env.AGENT_SESSION_TITLE, text };
  } else throw new Error('Usage: session.mjs handoff request.json | preview document.md | report result.md|-');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  const result = spawnSync('nvim', ['--headless', '--server', server, '--remote-expr', `v:lua.${fn}('${encoded}')`], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  process.exitCode = result.status === 0 && !/(FAIL:|PENDING:)/.test(String(result.stdout)) ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
