import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function extract(text, tag) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) throw new Error('Invalid tag');
  const lines = text.split(/\r?\n/);
  const target = `## ${tag.slice(1)}`;
  const matches = lines.flatMap((line, i) => line === target ? [i] : []);
  if (matches.length !== 1) throw new Error('Version missing or duplicated');
  const start = matches[0] + 1;
  let end = start;
  while (end < lines.length && !/^##(?:\s|$)/.test(lines[end])) end++;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const body = lines.slice(start, end).join(newline).trim();
  if (!body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/).some(line => line.trim() && !/^\s*#{1,6}(?:\s|$)/.test(line))) throw new Error('Empty release notes');
  return body;
}

export function publish(tag, changelog, assets, notes, run) {
  const body = extract(changelog, tag);
  if (assets.length !== 2) throw new Error('Two assets required');
  for (const asset of assets) if (!statSync(asset).isFile() || statSync(asset).size === 0) throw new Error(`Invalid asset: ${asset}`);
  writeFileSync(notes, body, 'utf8');
  const view = run(['release', 'view', tag]);
  if (view !== 0 && view !== 1) throw new Error('Release lookup failed');
  const command = view === 0 ? ['release', 'edit', tag, '--notes-file', notes] : ['release', 'create', tag, '--verify-tag', '--title', tag, '--notes-file', notes];
  if (run(command) !== 0) throw new Error('Release update failed');
  if (run(['release', 'upload', tag, ...assets, '--clobber']) !== 0) throw new Error('Release upload failed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [tag, exe, pdf, notes] = process.argv.slice(2);
    if (!tag || !exe || !pdf || !notes || process.argv.length !== 6) throw new Error('Usage: release.mjs TAG EXE PDF NOTES');
    publish(tag, readFileSync('CHANGELOG.md', 'utf8'), [exe, pdf], notes, args => {
      const result = spawnSync('gh', args, { encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status !== 0 && args[1] === 'view' && /release not found/i.test(result.stderr)) return 1;
      if (result.status !== 0) { process.stderr.write(result.stderr || 'gh failed\n'); return 2; }
      return 0;
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
