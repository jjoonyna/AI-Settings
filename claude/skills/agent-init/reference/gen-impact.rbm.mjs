// docs/tools/gen-impact.mjs — docs/impact.md 의 생성 절(A~D, G, H)을 코드·SQL 에서 계수해 다시 쓴다.
// 수동 절(E, F)은 보존한다. 두 번 돌려도 같은 출력이 나오도록 모든 목록을 정렬한다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BE = path.join(ROOT, 'backend/src/main/java');
const BE_TESTS = path.join(ROOT, 'backend/src/test');
const FE = path.join(ROOT, 'frontend/src');
const FE_TESTS = path.join(ROOT, 'frontend/tests');
const DDL = path.join(ROOT, 'scripts/sql/exrbm_db.sql');
const OUT = path.join(ROOT, 'docs/impact.md');
const THRESHOLD = 3; // 참조 파일 3개 이상만 출력 (스펙 §5)

// ── 설정 블록: 여기만 손으로 고친다 ─────────────────────────────
// KEY_COLUMNS: fe=false 면 프론트 열을 검사하지 않는다. beScope='sql' 이면 백엔드 매칭을
// Java 문자열 리터럴(SQL 텍스트) 안으로만 좁힌다(변수명·주석·Swagger 버전 표기 등의 우연 일치 방지).
const KEY_COLUMNS = [
  { col: 'active', fe: true, beScope: 'sql' },
  { col: 'sens_status', fe: true, beScope: 'all' },
  { col: 'display_name', fe: true, beScope: 'all' },
  { col: 'machine_display_name', fe: true, beScope: 'all' },
  { col: 'tag_display_name', fe: true, beScope: 'all' },
  { col: 'conn_type', fe: true, beScope: 'all' },
  { col: 'data_type', fe: true, beScope: 'all' },
  { col: 'VERSION', fe: false, beScope: 'sql' },
  { col: 'LEVEL_B', fe: true, beScope: 'all' },
  { col: 'LEVEL_C', fe: true, beScope: 'all' },
  { col: 'LEVEL_D', fe: true, beScope: 'all' },
  { col: 'LEVEL_STOP', fe: true, beScope: 'all' },
  { col: 'LEVEL_RUN', fe: true, beScope: 'all' },
  { col: 'use_status', fe: true, beScope: 'all' },
  { col: 'user_grade', fe: true, beScope: 'all' },
  { col: 'point_no', fe: true, beScope: 'all' },
  { col: 'machine_cd', fe: true, beScope: 'all' },
  { col: 'faci_cd', fe: true, beScope: 'all' },
];
const VALUE_SETS = [
  { name: 'TIMEZONE / DATA_TIMEZONE', values: ['KST', 'UTC'] },
  { name: 'PIPELINE_MODE', values: ['OPC', 'RBM'], skipLang: true },
  { name: 'data_type', values: ['VIB', 'TEMP'], note: '값 집합은 열려 있다 — 센서는 경로 `<태그>_<타입>` 의 타입, PLC 태그(`is_plc`)는 경로 꼬리가 그대로 타입이며 형식은 `^[A-Z0-9_]{1,30}$`(`DataTypeCode`). 아래 목록은 `VIB`·`TEMP` 리터럴을 쓰는 파일이다.' },
  { name: 'conn_type', values: ['WIRED', 'SENSOTECH', 'RONDS'] },
  { name: 'user_grade', values: ['MASTER', 'SALES', 'ADMIN', 'USER', 'API'] },
  { name: 'sens_status 코드', values: ['21', '40', '41'], wordOnly: true, requireContext: /sens_status|SENS_STATUS/ },
  { name: 'HIDDEN_PAGES / HIDDEN_FEATURES 키', values: ['report', 'tsdv', 'orbit', 'envelope', 'typeTrend', 'faultList', 'maintenance'], feOnly: true, skipLang: true },
];
// MARKERS 항목은 문자열(부분일치) 또는 { re: RegExp } 둘 다 지원한다.
const MARKERS = {
  '동시성': ['@Scheduled', 'synchronized', 'ConcurrentHashMap', 'ConcurrentSkipList', 'AtomicInteger', 'AtomicLong', 'AtomicReference', 'AtomicBoolean', 'volatile ', 'Executor', 'VirtualThread', 'newVirtualThreadPerTaskExecutor', 'Caffeine', { re: /VERSION\s*=\s*VERSION\s*\+\s*1/i, label: 'VERSION = VERSION + 1' }, 'AlarmStateTracker', 'SessionRegistry', 'RbmThresholdCache', 'ReentrantLock', { re: /FOR\s+UPDATE/i, label: 'FOR UPDATE' }, '@EnableScheduling', 'spring.task.scheduling'],
  '지연 표시': ['createWidget', 'busy:', 'busy,', '.load-state', 'setInterval', '.refresh()', 'slot: null'],
  '보안·권한': ['hasRole(', 'hasAnyRole(', 'requestMatchers(', 'permitAll', 'assertEquipAccess', 'assertFaciAccess', 'allowedEquipIds', '@Profile('],
  '파일·프로세스 I/O': ['ProcessBuilder', 'Runtime.getRuntime().exec', 'Files.', 'FileWriter', '.dat"', '.map"', 'ParquetFileReader', 'ArrowReader'],
  '모드 분기': ['@ConditionalOnProperty(name = "app.pipeline.mode"', 'app.pipeline.mode', 'getPipelineMode()', 'PIPELINE_MODE'],
};
// ─────────────────────────────────────────────────────────────────

const walk = (dir, exts) => {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  if (!fs.statSync(dir).isDirectory()) return exts.some(x => dir.endsWith(x)) ? [dir] : [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some(x => e.name.endsWith(x))) out.push(p);
  }
  return out.sort();
};
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const read = p => fs.readFileSync(p, 'utf8');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uniqSorted = a => [...new Set(a)].sort();
const beFiles = walk(BE, ['.java']).map(p => ({ p, r: rel(p), s: read(p) }));
const beTestFiles = walk(BE_TESTS, ['.java']).map(p => ({ p, r: rel(p), s: read(p) }));
const feFiles = walk(FE, ['.js', '.html']).map(p => ({ p, r: rel(p), s: read(p) }));
const feFilesWithCss = walk(FE, ['.js', '.html', '.css']).map(p => ({ p, r: rel(p), s: read(p) }));
const teFiles = walk(FE_TESTS, ['.js']).map(p => ({ p, r: rel(p), s: read(p) }));
const cfgFiles = ['scripts', 'configs', 'DEPLOYMENT.md', 'frontend/public', 'backend/src/main/resources']
  .flatMap(d => walk(path.join(ROOT, d), ['.md', '.js', '.yml', '.yaml', '.bat', '.env', '.example', '.conf', '.sql']))
  .map(p => ({ r: rel(p), s: read(p) }));
const fePublicFiles = walk(path.join(ROOT, 'frontend/public'), ['.js', '.example']).map(p => ({ r: rel(p), s: read(p) }));
const simpleName = f => path.basename(f.p).replace(/\.(java|js|html)$/, '');
const screenOf = r => (r.match(/exrbm\/api\/([^/]+)\//) || r.match(/frontend\/src\/sub\d+\/([^/]+)\//) || [, null])[1];

// 문자열 리터럴(Java 큰따옴표)만 뽑아 합친 블롭 — SQL 텍스트 문맥 매칭용(변수명·주석·Swagger 표기 오탐 방지)
const sqlBlobCache = new Map();
const sqlBlobOf = f => {
  if (sqlBlobCache.has(f.r)) return sqlBlobCache.get(f.r);
  const m = f.s.match(/"(?:[^"\\]|\\.)*"/g) || [];
  const blob = m.join(' ');
  sqlBlobCache.set(f.r, blob);
  return blob;
};

// A. 테이블 × 읽기/쓰기 + 스키마 정본
const ddl = fs.existsSync(DDL) ? read(DDL).split(/\r?\n/) : [];
const tables = [];
ddl.forEach((line, i) => { const m = line.match(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?/i); if (m) tables.push({ name: m[1], ddlLine: i + 1 }); });
const controllers = beFiles.filter(f => /\/api\//.test(f.r));
const classRefRe = n => new RegExp(`\\b${esc(n)}\\b`);
const sectionA = tables.sort((a, b) => a.name.localeCompare(b.name)).map(t => {
  const w = new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|REPLACE\\s+INTO)\\s+\`?${esc(t.name)}\\b`, 'i');
  const rd = new RegExp(`\\b(FROM|JOIN)\\s+\`?${esc(t.name)}\\b`, 'i');
  const writers = beFiles.filter(f => w.test(f.s)).map(f => simpleName(f));
  const readers = beFiles.filter(f => rd.test(f.s)).map(f => simpleName(f)); // 쓰기와 독립 판정 — 겸용 파일도 양쪽에 나온다
  const all = uniqSorted([...writers, ...readers]);
  const entity = beFiles.filter(f => /\/entity\//.test(f.r) && new RegExp(`\\b${esc(t.name)}\\b`, 'i').test(f.s)).map(f => simpleName(f));
  const rows = beFiles.filter(f => /\/mapper\//.test(f.r) && new RegExp(`\\b${esc(t.name)}\\b`, 'i').test(f.s)).map(f => simpleName(f));
  if (all.length === 0) return null;
  // 서비스는 보통 Repository 인터페이스(Impl 이 구현)를 참조하므로 "XxxImpl" → "Xxx" 도 함께 찾는다
  const allRefs = uniqSorted([...all, ...all.map(n => n.replace(/Impl$/, '')).filter(n => n)]);
  // 화면: 1-hop(컨트롤러가 직접 참조) ∪ 2-hop(서비스가 참조 → 그 서비스를 컨트롤러가 참조)
  const hop1 = controllers.filter(f => allRefs.some(n => classRefRe(n).test(f.s))).map(f => screenOf(f.r));
  const midNames = uniqSorted(beFiles.filter(f => !/\/api\//.test(f.r) && allRefs.some(n => classRefRe(n).test(f.s))).map(simpleName));
  const hop2 = controllers.filter(f => midNames.some(n => classRefRe(n).test(f.s))).map(f => screenOf(f.r));
  const screens = uniqSorted([...hop1, ...hop2].filter(Boolean));
  return `### ${t.name}\n- 스키마 정본: \`scripts/sql/exrbm_db.sql:${t.ddlLine}\`${entity.length ? ` · 엔티티 ${entity.map(x => `\`${x}\``).join(', ')}` : ''}${rows.length ? ` · Row ${rows.map(x => `\`${x}\``).join(', ')}` : ''}\n- 쓰기: ${writers.length ? uniqSorted(writers).map(x => `\`${x}\``).join(', ') : '(없음 — 외부 기록자, §E 참조)'}\n- 읽기: ${uniqSorted(readers).map(x => `\`${x}\``).join(', ') || '(없음)'}\n- 화면: ${screens.join(' · ') || '(직접 소비 화면 없음)'}`;
}).filter(Boolean).join('\n\n');

// B. 핵심 컬럼 × 읽기/쓰기
const sectionB = KEY_COLUMNS.map(({ col, fe, beScope }) => {
  const re = new RegExp(`\\b${esc(col)}\\b`, 'i');
  const w = new RegExp(`\\b(SET|INSERT\\s+INTO[^;]*\\()[^;]*\\b${esc(col)}\\b`, 'i');
  const scope = f => beScope === 'sql' ? sqlBlobOf(f) : f.s;
  const beCandidates = beFiles.filter(f => simpleName(f) !== 'SwaggerConfig');
  const writers = beCandidates.filter(f => w.test(scope(f))).map(simpleName);
  const readers = beCandidates.filter(f => re.test(scope(f))).map(simpleName); // 쓰기와 독립 판정
  const camel = s => s.toLowerCase().replace(/_(\w)/g, (_, c) => c.toUpperCase());
  const feHits = fe ? feFiles.filter(f => new RegExp(`\\b(${esc(col)}|${esc(camel(col))})\\b`).test(f.s)).map(f => f.r) : [];
  return `### ${col}\n- 쓰기: ${uniqSorted(writers).map(x => `\`${x}\``).join(', ') || '(없음)'}\n- 읽기(백엔드): ${uniqSorted(readers).map(x => `\`${x}\``).join(', ') || '(없음)'}\n- 프론트: ${fe ? (uniqSorted(feHits).map(x => `\`${x}\``).join(', ') || '(없음)') : '(백엔드 전용 — 프론트 미노출)'}`;
}).join('\n\n');

// C. 엔드포인트 → 프론트 소비
const endpoints = [];
for (const f of beFiles.filter(f => /Controller\.java$/.test(f.r))) {
  const base = (f.s.match(/@RequestMapping\(\s*(?:value\s*=\s*)?"([^"]*)"/) || [, ''])[1];
  for (const m of f.s.matchAll(/@(Get|Post|Put|Delete|Patch)Mapping(?:\(\s*(?:value\s*=\s*)?"([^"]*)"|\(\)|)/g)) {
    endpoints.push({ method: m[1].toUpperCase(), path: (base + (m[2] || '')).replace(/\/+/g, '/').replace(/\{[^}]+\}/g, '*'), ctrl: simpleName(f) });
  }
}
// 소비처 후보: js/api/ 전부 + fetchArrow 정의처(arrowParser.js)·auth.js 의 직접 fetch('/api/…') 호출
const EXTRA_CONSUMER_FILES = ['frontend/src/js/common/auth.js', 'frontend/src/sub09/tsdv/arrowParser.js'];
const apiFiles = feFiles.filter(f => /\/js\/api\//.test(f.r) || EXTRA_CONSUMER_FILES.includes(f.r));
// api 파일의 `const BASE = '...'` 를 풀어 텍스트 안 `${BASE}/x` · `BASE + '/x'` · `fetchArrow('/x'` 를
// 완전 경로 리터럴로 덧붙인 매칭용 텍스트를 만든다 — 함수 블록 단위로도 같은 방식을 적용해 좁힌다
const expandText = (text, base) => {
  let extra = '';
  if (base) {
    for (const m of text.matchAll(/`\$\{BASE\}([^`]*)`/g)) extra += ` ${base}${m[1]}`;
    for (const m of text.matchAll(/BASE\s*\+\s*'([^']*)'/g)) extra += ` ${base}${m[1]}`;
    for (const m of text.matchAll(/fetchArrow\(\s*'([^']+)'/g)) extra += ` ${base}${m[1]}`;
  }
  return text.replace(/\$\{[^}]+\}/g, 'X') + extra;
};
const baseOf = f => (f.s.match(/const BASE\s*=\s*'([^']*)'/) || [, ''])[1];
const expandedCache = new Map();
const expandedOf = f => {
  if (!expandedCache.has(f.r)) expandedCache.set(f.r, expandText(f.s, baseOf(f)));
  return expandedCache.get(f.r);
};
// export function(선언 지점)을 뽑아 endpoint 매칭을 함수 단위로 좁힌다(과대 연결 방지)
const functionBlocksOf = f => {
  const positions = [...f.s.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m => ({ name: m[1], idx: m.index }));
  return positions.map((p, i) => ({ name: p.name, body: f.s.slice(p.idx, i + 1 < positions.length ? positions[i + 1].idx : f.s.length) }));
};
const importsName = (file, name) => new RegExp(`import\\s*\\{[^}]*\\b${esc(name)}\\b[^}]*\\}`).test(file.s);
const sectionC = uniqSorted(endpoints.map(e => `${e.method} ${e.path}|${e.ctrl}`)).map(k => {
  const [sig, ctrl] = k.split('|');
  const p = sig.split(' ')[1];
  // 프론트 api 파일은 fetchApi 의 BASE='/api' 를 자동으로 붙이므로 경로 문자열에는 접두어가 없다
  const pFe = p.replace(/^\/api/, '');
  const pattern = new RegExp(esc(pFe).replace(/\\\*/g, '[^`\'"?]+'));
  const consumers = apiFiles.filter(f => pattern.test(expandedOf(f)));
  // 매칭된 함수 이름만 뽑아, 그 이름을 import 하는 파일만 "페이지 소비"로 인정
  const fnNames = new Set();
  for (const f of consumers) {
    const blocks = functionBlocksOf(f);
    const base = baseOf(f);
    for (const blk of blocks) {
      if (pattern.test(expandText(blk.body, base))) fnNames.add(blk.name);
    }
    if (blocks.length === 0) {
      // export function 형태가 아닌 파일(auth.js 의 직접 fetch 등)은 파일 자체를 페이지 연결 단위로 쓴다
      fnNames.add(`__FILE__:${f.r}`);
    }
  }
  const pages = uniqSorted(feFiles.filter(g => [...fnNames].some(n => n.startsWith('__FILE__:') ? g.r === n.slice('__FILE__:'.length) : importsName(g, n))).map(g => screenOf(g.r)).filter(Boolean));
  const patternFull = new RegExp(esc(p).replace(/\\\*/g, '[^`\'"?]+'));
  const mocks = uniqSorted(teFiles.filter(t => patternFull.test(t.s)).map(t => t.r));
  return `| \`${sig}\` | \`${ctrl}\` | ${consumers.map(c => `\`${path.basename(c.r)}\``).join(', ') || '—'} | ${pages.join(' · ') || '—'} | ${mocks.map(m => `\`${path.basename(m)}\``).join(', ') || '—'} |`;
}).join('\n');

// D. 공용 모듈 fan-in
const importersOf = target => feFiles.filter(f => f.s.includes(`/${path.basename(target.r)}`) && f.r !== target.r).map(f => f.r);
const feShared = feFiles.filter(f => /\/js\/(common|components|api|document|lang)\//.test(f.r));
const feFan = feShared.map(f => ({ r: f.r, users: importersOf(f) })).filter(x => x.users.length >= THRESHOLD);
const beShared = beFiles.filter(f => /\/(common|config)\/|\/domain\/[^/]+\/util\//.test(f.r));
const beFan = beShared.map(f => { const n = simpleName(f); return { r: f.r, users: beFiles.filter(g => g.r !== f.r && new RegExp(`\\b${esc(n)}\\b`).test(g.s)).map(g => g.r) }; }).filter(x => x.users.length >= THRESHOLD);
const fanLines = xs => xs.sort((a, b) => b.users.length - a.users.length || a.r.localeCompare(b.r)).map(x => `### ${x.r} (${x.users.length})\n${uniqSorted(x.users).map(u => `- \`${u}\``).join('\n')}`).join('\n\n');
const sectionD = `#### 프론트\n\n${fanLines(feFan)}\n\n#### 백엔드\n\n${fanLines(beFan)}`;

// G. 코드값 사전
const allFiles = [...beFiles, ...beTestFiles, ...feFiles, ...teFiles, ...cfgFiles];
const sectionG = VALUE_SETS.map(v => {
  const pat = new RegExp(v.wordOnly ? `\\b(${v.values.map(esc).join('|')})\\b` : `['"\`](${v.values.map(esc).join('|')})['"\`]`);
  let domain = v.feOnly ? [...feFiles, ...teFiles, ...fePublicFiles] : allFiles;
  if (v.skipLang) domain = domain.filter(f => !/\/js\/lang\//.test(f.r));
  const hits = uniqSorted(domain.filter(f => {
    if (v.requireContext && !v.requireContext.test(f.s)) return false;
    return v.values.filter(val => pat.test(f.s) && f.s.includes(val)).length >= Math.min(2, v.values.length);
  }).map(f => f.r));
  return `### ${v.name} — \`${v.values.join(' | ')}\`\n${v.note ? `${v.note}\n` : ''}${hits.map(h => `- \`${h}\``).join('\n') || '- (없음)'}`;
}).join('\n\n');

// H. 횡단 성질 사전
const markerTest = (m, s) => typeof m === 'string' ? s.includes(m) : m.re.test(s);
const markerLabel = m => typeof m === 'string' ? m : m.label;
const sectionH = Object.entries(MARKERS).map(([name, marks]) => {
  const domain = name === '지연 표시' ? feFilesWithCss : [...beFiles, ...feFiles];
  const rows = marks.map(m => ({ m, files: uniqSorted(domain.filter(f => markerTest(m, f.s)).map(f => f.r)) })).filter(x => x.files.length);
  return `### ${name}\n${rows.map(x => `- \`${markerLabel(x.m)}\` (${x.files.length}): ${x.files.map(f => `\`${f}\``).join(', ')}`).join('\n')}`;
}).join('\n\n');

// 조립 — 수동 절 보존
const prev = fs.existsSync(OUT) ? read(OUT) : '';
const manualIdx = prev.indexOf('\n## E.');
const manual = manualIdx >= 0 ? prev.slice(manualIdx + 1) : `## E. 파생 관계·스키마 예외 (수동)\n\n(Task 14 에서 작성)\n\n## F. 문자열·복제 결합 (수동)\n\n(Task 14 에서 작성)\n`;
const head = (prev.match(/^기준: [^·]*(?=·|$)/m) || ['기준: (미설정) '])[0].trimEnd();
const doc = `${head} · 생성: \`node docs/tools/gen-impact.mjs\` (임계값 ${THRESHOLD}) · 수동 절: E, F
# 영향 지도

이것을 고치면 어디를 함께 고치나. A~D·G·H 는 생성 절이다 — 손으로 고치지 말고 스크립트를 고친다. 설명은 \`docs/flows/\` 에 있다.

## A. 테이블 × 읽기/쓰기 + 스키마 정본

${sectionA}

## B. 핵심 컬럼 × 읽기/쓰기

${sectionB}

## C. 엔드포인트 → 프론트 소비

| 엔드포인트 | 컨트롤러 | api 파일 | 페이지 | E2E mock |
|---|---|---|---|---|
${sectionC}

## D. 공용 모듈 fan-in (참조 ${THRESHOLD}개 이상)

${sectionD}

## G. 코드값 사전

${sectionG}

## H. 횡단 성질 사전

${sectionH}

${manual}`.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(OUT, doc.replace(/^기준: .*$/m, m => m.startsWith('기준: (미설정)') ? m : m), 'utf8');
console.log(`written ${rel(OUT)} — tables ${tables.length}, endpoints ${endpoints.length}, fe fan-in ${feFan.length}, be fan-in ${beFan.length}`);
