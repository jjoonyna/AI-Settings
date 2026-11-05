import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSessionModel } from './session-model.mjs';
import { connect } from './app-proxy.mjs';
import { saveRole } from './session-role.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validate(o, env = process.env) {
  const id = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID;
  if (!uuid.test(id || '') || (env.CODEX_THREAD_ID && env.CODEX_SESSION_ID && env.CODEX_THREAD_ID !== env.CODEX_SESSION_ID)) throw new Error('exact parent Codex ID required');
  const parent = resolveSessionModel(env);
  if (!parent?.model || parent.role !== 'plan') throw new Error('verified parent plan role and model required');
  const root = env.AI_SETTINGS_HOME || path.join(os.homedir(), '.ai-settings');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'models.json'), 'utf8').replace(/^\uFEFF/, ''));
  const actual = catalog.models.find(m => m.id === parent.model), selected = catalog.models.find(m => m.id === o.model);
  if (!actual || actual.vendor !== 'codex' || !selected || selected.vendor !== 'codex' || !Number.isFinite(actual.tier) || !Number.isFinite(selected.tier) || selected.tier > actual.tier) throw new Error('invalid model, vendor or parent tier');
  if (o.agent !== 'codex' || !['work', 'review'].includes(o.session)) throw new Error('only Codex work/review allowed');
  if ((o.parent_model && o.parent_model !== parent.model) || (o.parent_agent && o.parent_agent !== 'codex') || (o.parent_id && o.parent_id !== id)) throw new Error('parent metadata mismatch');
  for (const key of ['name', 'goal', 'scope', 'validation', 'prompt', 'spec_doc', 'plan_doc']) if (typeof o[key] !== 'string' || !o[key].trim()) throw new Error('required field: ' + key);
  if (/[\r\n\x00-\x1f]/.test(o.name)) throw new Error('invalid title');
  for (const key of ['spec_doc', 'plan_doc']) if (!fs.statSync(o[key]).isFile()) throw new Error('document not found: ' + key);
  const cwd = path.resolve(o.worktree || o.cwd || process.cwd()); if (!fs.statSync(cwd).isDirectory()) throw new Error('working directory not found');
  return { id, parent, cwd, title: `${o.session === 'work' ? '작업' : '리뷰'} | ${o.name}` };
}
export function checkSettings(result, o, cwd) {
  const type = o.session === 'review' ? 'dangerFullAccess' : 'workspaceWrite';
  if (!uuid.test(result?.thread?.id || '')) throw new Error('server returned invalid thread ID');
  if (result.model !== o.model || result.approvalPolicy !== (o.session === 'review' ? 'never' : 'on-request') || result.approvalsReviewer !== 'auto_review' || result.sandbox?.type !== type || path.resolve(result.cwd || '') !== cwd) throw new Error('server model, sandbox, approval or cwd mismatch');
}
export async function handoff(o, env = process.env, open = connect) {
  const context = validate(o, env), client = await open(); let id;
  try {
    const result = await client.request('thread/start', { model: o.model, cwd: context.cwd, sandbox: o.session === 'review' ? 'danger-full-access' : 'workspace-write', approvalPolicy: o.session === 'review' ? 'never' : 'on-request', approvalsReviewer: 'auto_review', ephemeral: false });
    id = result?.thread?.id;
    checkSettings(result, o, context.cwd);
    saveRole('codex', id, o.session, env);
    await client.request('thread/name/set', { threadId: id, name: context.title });
    const prompt = [`역할: ${o.session}`, `작업 제목: ${o.name}`, `호출 모델: ${context.parent.model}`, `작업 모델: ${o.model}`, `부모 대화: ${context.id}`, `목표: ${o.goal}`, `담당 범위: ${o.scope}`, `확정 결정·제약: ${o.decisions || ''}`, `spec: ${o.spec_doc}`, `plan: ${o.plan_doc}`, `관련 문서: ${o.references || ''}`, `작업 위치: ${context.cwd}`, `완료·검증 기준: ${o.validation}`, `중단 조건: 주요 구현 결정·범위 변경 또는 해결 불가 시 부모에게 보고`, o.prompt, '재위임 금지. 사용자 명시 지시 없이 commit/merge/push 금지.', o.session === 'review' ? '읽기 전용 리뷰다. 코드, 문서 또는 파일을 수정·생성·삭제하지 않는다. 실제 변경 원문과 요구사항·검증 근거를 확인한다.' : '', '완료 범위, 변경 파일, 검증 명령·결과, 미해결 문제, 다음 판단을 최종 응답으로 보고한다. 부모가 직접 읽어 수신 확인한다.'].join('\n');
    const turn = await client.request('turn/start', { threadId: id, input: [{ type: 'text', text: prompt, text_elements: [] }] });
    if (!uuid.test(turn?.turn?.id || '')) throw new Error('server returned invalid turn ID');
    return { threadId: id, title: context.title, turnId: turn?.turn?.id, status: turn?.turn?.status };
  } catch (error) { if (id) error.message = `created thread ${id}: ${error.message}`; throw error; }
  finally { client.close(); }
}
export async function readThread(id, expectedTurnId, open = connect) {
  if (!uuid.test(id || '')) throw new Error('exact thread ID required');
  if (expectedTurnId !== undefined && !uuid.test(expectedTurnId)) throw new Error('exact expected turn ID required');
  const client = await open();
  try {
    const read = await client.request('thread/read', { threadId: id, includeTurns: false });
    const turns = await client.request('thread/turns/list', { threadId: id, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
    const turn = turns.data?.[0];
    let cursor, items = [], pages = 0;
    if (turn) do {
      const page = await client.request('thread/items/list', { threadId: id, turnId: turn.id, limit: 100, cursor });
      if (!Array.isArray(page.data) || ++pages > 1000 || (page.nextCursor && page.nextCursor === cursor)) throw new Error('invalid item pagination');
      items.push(...page.data); cursor = page.nextCursor;
    } while (cursor);
    const final = items.map(entry => entry.item).filter(item => item?.type === 'agentMessage' && item.phase === 'final_answer').at(-1)?.text;
    const live = read.thread?.status?.type;
    const matches = expectedTurnId === undefined ? null : turn?.id === expectedTurnId;
    const reliable = matches === true;
    const status = live === 'active' ? 'active' : !reliable ? 'unknown' : turn?.status === 'completed' && final ? 'completed' : turn?.status === 'failed' ? 'failed' : turn?.status === 'interrupted' ? 'interrupted' : 'unknown';
    return { thread: read.thread, status, expectedTurnId: expectedTurnId ?? null, expectedTurnMatches: matches, latestTurn: turn, final: final ?? null };
  } finally { client.close(); }
}
