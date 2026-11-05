// Only close an explicitly completed child after its parent has accepted the report.
const fs = require('fs');
const { spawnSync } = require('child_process');
function main() {
  if (!['work', 'review'].includes(process.env.AGENT_SESSION_ROLE)) return;
  const server = process.env.AGENT_PARENT_SERVER, id = Number(process.env.AGENT_PARENT_ID);
  if (!server || !Number.isInteger(id) || !process.env.NVIM) return;
  let text = '';
  try {
    if (process.argv.includes('--codex')) {
      const data = JSON.parse(process.argv.at(-1));
      if (data.type && data.type !== 'agent-turn-complete') return;
      text = data['last-assistant-message'] || '';
    } else {
      const data = JSON.parse(fs.readFileSync(0, 'utf8'));
      if (data.stop_hook_active) return;
      const records = fs.readFileSync(data.transcript_path, 'utf8').trim().split('\n');
      for (const line of records.reverse()) {
        let record; try { record = JSON.parse(line); } catch { continue; }
        if (record.type !== 'assistant') continue;
        const content = record.message?.content;
        text = typeof content === 'string' ? content : (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
        if (text) break;
      }
    }
  } catch { return; }
  if (!text.trimEnd().endsWith('[AGENT-DONE]')) return;
  const payload = Buffer.from(JSON.stringify({ parent_id: id, owner: Number(process.env.AGENT_SESSION_ID), task_id: process.env.AGENT_TASK_ID,
    text, from: process.env.AGENT_SESSION_TITLE || 'child' })).toString('base64');
  const result = spawnSync('nvim', ['--headless', '--server', server, '--remote-expr', `v:lua.AgentReceiveReport64('${payload}')`], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.status !== 0 || !(result.stdout || '').includes('OK')) return;
  // Parent owns closing a reviewed child; never kill an ancestor from a hook.
}
main();
