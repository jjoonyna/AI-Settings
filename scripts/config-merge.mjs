// Preserve unowned TOML text, including nested tables and multiline values.
// Managed scalar/array assignments are replaced as complete logical statements.
export function statements(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const result = []; let chunk = [], quote = '', depth = 0;
  for (const line of lines) {
    chunk.push(line);
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (quote.startsWith('"') && c === '\\') { i++; continue; }
        if (line.startsWith(quote, i)) { i += quote.length - 1; quote = ''; }
      } else {
        if (c === '#') break;
        if (c === '"' || c === "'") {
          quote = line.slice(i, i + 3) === c.repeat(3) ? c.repeat(3) : c;
          i += quote.length - 1;
        } else if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') depth--;
      }
    }
    if (!quote && depth === 0) { result.push(chunk.join('\n')); chunk = []; }
  }
  if (chunk.length || quote || depth !== 0) throw new Error('Incomplete TOML: refusing to overwrite');
  return result;
}

// TOML key paths retain literal dots within quoted segments.
function keyPath(text, terminator) {
  let i = 0; const parts = [];
  const space = () => { while (text[i] === ' ' || text[i] === '\t') i++; };
  while (true) {
    space(); let value = '';
    if (text[i] === "'" || text[i] === '"') {
      const quote = text[i++]; let closed = false;
      while (i < text.length) {
        const c = text[i++];
        if (c === quote) { closed = true; break; }
        if (c === '\n' || c === '\r' || c.charCodeAt(0) < 0x20) throw new Error('Invalid TOML key');
        if (c !== '\\' || quote === "'") { value += c; continue; }
        const escape = text[i++];
        const simple = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
        if (Object.hasOwn(simple, escape)) { value += simple[escape]; continue; }
        if (escape !== 'u' && escape !== 'U') throw new Error('Unsupported TOML key escape');
        const length = escape === 'u' ? 4 : 8, hex = text.slice(i, i + length);
        if (!new RegExp('^[0-9a-fA-F]{' + length + '}$').test(hex)) throw new Error('Invalid TOML key escape');
        const cp = parseInt(hex, 16);
        if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new Error('Invalid TOML key codepoint');
        value += String.fromCodePoint(cp); i += length;
      }
      if (!closed) throw new Error('Unterminated TOML key');
    } else {
      const m = text.slice(i).match(/^[A-Za-z0-9_-]+/);
      if (!m) throw new Error('Unsupported TOML key');
      value = m[0]; i += value.length;
    }
    parts.push(value); space();
    if (text[i] === terminator || (terminator === '' && i === text.length)) return { parts, end: i };
    if (text[i] !== '.') throw new Error('Invalid TOML key path');
    i++;
  }
}
const canonical = parts => parts.map(p => /^[A-Za-z0-9_-]+$/.test(p) ? p : JSON.stringify(p)).join('.');
function parseRow(row) {
  const trimmed = row.trimStart();
  if (!trimmed || trimmed[0] === '#') return null;
  if (trimmed.startsWith('[[')) return { array: true };
  if (trimmed[0] === '[') {
    const parsed = keyPath(trimmed.slice(1), ']');
    if (!/^\]\s*(?:#.*)?$/.test(trimmed.slice(parsed.end + 1))) throw new Error('Invalid TOML table');
    return { header: parsed.parts };
  }
  const parsed = keyPath(trimmed, '=');
  return { parts: parsed.parts, lhs: trimmed.slice(0, parsed.end).trimEnd(), value: trimmed.slice(parsed.end + 1).trim() };
}

export function mergeToml(text, managed) {
  const rows = statements(text); let table = [], array = false;
  const seen = new Set(); const changes = new Map();
  for (const [key, value] of Object.entries(managed)) changes.set(canonical(keyPath(key, '').parts), value);
  const output = rows.map(row => {
    const parsed = parseRow(row);
    if (!parsed) return row;
    if (parsed.array) { array = true; return row; }
    if (parsed.header) { table = parsed.header; array = false; return row; }
    if (array) return row;
    const key = canonical([...table, ...parsed.parts]);
    if (parsed.value.startsWith('{') && [...changes.keys()].some(k => k.startsWith(key + '.'))) throw new Error('Inline TOML table overlaps managed keys: ' + key);
    if (!changes.has(key)) return row;
    if (seen.has(key)) throw new Error('Duplicate TOML key: ' + key);
    seen.add(key);
    return changes.get(key) === null ? '' : `${parsed.lhs} = ${changes.get(key)}`;
  });
  const groups = new Map();
  for (const [key, value] of changes) {
    if (seen.has(key) || value === null) continue;
    const parts = keyPath(key, '').parts, section = canonical(parts.slice(0, -1)), name = canonical(parts.slice(-1));
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(`${name} = ${value}`);
  }
  for (const [section, values] of groups) {
    if (!section) { output.unshift(...values, ''); continue; }
    const index = output.findIndex(row => { const p = parseRow(row); return p?.header && canonical(p.header) === section; });
    if (index >= 0) output.splice(index + 1, 0, ...values);
    else output.push('', `[${section}]`, ...values);
  }
  return output.join('\n').trimEnd() + '\n';
}

export function tomlValues(text) {
  let table = [], array = false; const values = {};
  for (const row of statements(text)) {
    const parsed = parseRow(row);
    if (!parsed) continue;
    if (parsed.array) { array = true; continue; }
    if (parsed.header) { table = parsed.header; array = false; continue; }
    if (!array) values[canonical([...table, ...parsed.parts])] = parsed.value;
  }
  return values;
}

// Three-way ownership removal: changes made after installation survive.
export function unmergeJson(current, managed, original = {}) {
  const result = structuredClone(current);
  for (const [key, value] of Object.entries(managed)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object') {
      result[key] = unmergeJson(result[key], value, original?.[key] || {});
      if (Object.keys(result[key]).length === 0 && !Object.hasOwn(original || {}, key)) delete result[key];
    } else if (JSON.stringify(result[key]) === JSON.stringify(value)) {
      if (Object.hasOwn(original || {}, key)) result[key] = structuredClone(original[key]); else delete result[key];
    }
  }
  return result;
}

export function stripManagedStopHooks(groups, commands) {
  return groups.map(group => ({ ...group, hooks: (group.hooks || []).filter(hook => !commands.includes(hook.command)) }))
    .filter(group => group.hooks.length > 0);
}

export function mergeJson(local, managed) {
  if (!local || typeof local !== 'object' || Array.isArray(local)) return structuredClone(managed);
  const out = structuredClone(local);
  for (const [key, value] of Object.entries(managed)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeJson(out[key], value) : structuredClone(value);
  }
  return out;
}

export function mergeHooks(current, managed) {
  const result = structuredClone(current || {});
  for (const [event, groups] of Object.entries(managed || {})) {
    const commands = groups.flatMap(g => g.hooks || []).map(h => h.command);
    result[event] = [...stripManagedStopHooks(result[event] || [], commands), ...structuredClone(groups)];
  }
  return result;
}

export function unmergeHookConfig(current, managed, original) {
  const result = unmergeJson(current, managed, original);
  for (const [event, groups] of Object.entries(managed.hooks || {})) {
    const commands = groups.flatMap(g => g.hooks || []).map(h => h.command);
    const kept = stripManagedStopHooks(current.hooks?.[event] || [], commands);
    if (kept.length) { result.hooks ||= {}; result.hooks[event] = kept; }
    else if (result.hooks) delete result.hooks[event];
  }
  if (result.hooks && !Object.keys(result.hooks).length) delete result.hooks;
  return result;
}
