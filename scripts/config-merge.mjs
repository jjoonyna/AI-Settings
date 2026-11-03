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

export function mergeToml(text, managed) {
  const rows = statements(text); let table = '';
  const seen = new Set(); const changes = new Map(Object.entries(managed));
  const output = rows.map(row => {
    const header = row.match(/^\s*\[([^\[\]\n]+)\]\s*(?:#.*)?$/);
    if (header) { table = header[1].trim(); return row; }
    if (/^\s*\[\[/.test(row)) { table = '__array_table__'; return row; }
    const assignment = row.match(/^\s*([\w-]+)\s*=/);
    if (!assignment) return row;
    const key = (table ? table + '.' : '') + assignment[1];
    if (!changes.has(key)) return row;
    if (seen.has(key)) throw new Error('Duplicate TOML key: ' + key);
    seen.add(key);
    return changes.get(key) === null ? '' : `${assignment[1]} = ${changes.get(key)}`;
  });
  const groups = new Map();
  for (const [key, value] of changes) {
    if (seen.has(key)) continue;
    if (value === null) continue;
    const dot = key.lastIndexOf('.'); const section = dot < 0 ? '' : key.slice(0, dot);
    const name = dot < 0 ? key : key.slice(dot + 1);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(`${name} = ${value}`);
  }
  for (const [section, values] of groups) {
    if (!section) { output.unshift(...values, ''); continue; }
    const index = output.findIndex(row => row.match(/^\s*\[([^\[\]\n]+)\]\s*(?:#.*)?$/)?.[1].trim() === section);
    if (index >= 0) output.splice(index + 1, 0, ...values);
    else output.push('', `[${section}]`, ...values);
  }
  return output.join('\n').trimEnd() + '\n';
}

export function tomlValues(text) {
  let table = ''; const values = {};
  for (const row of statements(text)) {
    const header = row.match(/^\s*\[([^\[\]\n]+)\]\s*(?:#.*)?$/);
    if (header) { table = header[1].trim(); continue; }
    if (/^\s*\[\[/.test(row)) { table = '__array_table__'; continue; }
    const item = row.match(/^\s*([\w-]+)\s*=\s*([\s\S]*)$/);
    if (item) values[(table ? table + '.' : '') + item[1]] = item[2].trim();
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
