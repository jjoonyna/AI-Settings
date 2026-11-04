import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const MAX = 16 * 1024 * 1024;
function version(value) {
  const match = /^(?:codex(?:-cli)?\s+)?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(value);
  return match && { numbers: match.slice(1, 4).map(Number), prerelease: match[4]?.split('.') };
}
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] - b.numbers[i];
  if (!a.prerelease || !b.prerelease) return Number(!a.prerelease) - Number(!b.prerelease);
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const x = a.prerelease[i], y = b.prerelease[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    return xn && yn ? Number(x) - Number(y) : xn !== yn ? (xn ? -1 : 1) : x < y ? -1 : 1;
  }
  return 0;
}
export function executable(env = process.env, platform = process.platform, run = execFileSync) {
  if (platform === 'win32' && env.LOCALAPPDATA && path.isAbsolute(env.LOCALAPPDATA)) {
    const root = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    let entries = []; try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch {}
    let best;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const file = path.join(root, entry.name, 'codex.exe');
      try {
        const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const parsed = version(run(file, ['--version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 4096, windowsHide: true }));
        if (parsed && (!best || compare(parsed, best.version) > 0)) best = { file, version: parsed };
      } catch { /* Ignore missing, invalid or unusable app cores. */ }
    }
    if (best) return best.file;
  }
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    for (const name of platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']) {
      const file = path.resolve(dir.replace(/^"|"$/g, ''), name);
      try { if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  throw new Error('codex executable not found on PATH');
}
export function frame(payload, opcode = 1) {
  payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (payload.length > MAX || (opcode >= 8 && payload.length > 125)) throw new Error('frame too large');
  const h = Buffer.alloc(payload.length < 126 ? 2 : payload.length <= 65535 ? 4 : 10);
  h[0] = 0x80 | opcode;
  if (h.length === 2) h[1] = 0x80 | payload.length;
  else if (h.length === 4) { h[1] = 0x80 | 126; h.writeUInt16BE(payload.length, 2); }
  else { h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(payload.length), 2); }
  const mask = crypto.randomBytes(4), data = Buffer.from(payload);
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  return Buffer.concat([h, mask, data]);
}
export class Frames {
  constructor(onMessage, onControl) { this.buffer = Buffer.alloc(0); this.parts = []; this.size = 0; this.onMessage = onMessage; this.onControl = onControl; }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const a = this.buffer[0], b = this.buffer[1], op = a & 15, fin = !!(a & 128);
      if ((a & 0x70) || (b & 128) || ![0, 1, 8, 9, 10].includes(op)) throw new Error('invalid server frame');
      let n = b & 127, offset = 2;
      if (n === 126) { if (this.buffer.length < 4) return; n = this.buffer.readUInt16BE(2); offset = 4; if (n < 126) throw new Error('invalid frame length'); }
      else if (n === 127) { if (this.buffer.length < 10) return; const big = this.buffer.readBigUInt64BE(2); if (big <= 65535n || big > BigInt(MAX)) throw new Error('invalid frame length'); n = Number(big); offset = 10; }
      if (n > MAX || (op >= 8 && (!fin || n > 125))) throw new Error('invalid frame length');
      if (this.buffer.length < offset + n) return;
      const payload = this.buffer.subarray(offset, offset + n); this.buffer = this.buffer.subarray(offset + n);
      if (op >= 8) { this.onControl(op, payload); continue; }
      if ((op === 0) !== (this.parts.length > 0)) throw new Error('invalid fragmented message');
      this.size += n; if (this.size > MAX) throw new Error('message too large');
      this.parts.push(payload);
      if (fin) { const message = Buffer.concat(this.parts); this.parts = []; this.size = 0; this.onMessage(message); }
    }
  }
}
export async function connect() {
  const exe = executable();
  let command = exe, args = ['app-server', 'proxy'];
  if (process.platform === 'win32' && /\.cmd$/i.test(exe)) {
    if (/[%!&|<>^\r\n"]/.test(exe)) throw new Error('unsafe codex.cmd path');
    command = process.env.ComSpec || 'cmd.exe'; args = ['/d', '/s', '/c', `""${exe}" app-server proxy"`];
  }
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: command !== exe });
  let buffer = Buffer.alloc(0), ready = false, closed = false, seq = 0, stderr = '';
  const pending = new Map();
  let resolveHandshake, rejectHandshake;
  const handshake = new Promise((resolve, reject) => { resolveHandshake = resolve; rejectHandshake = reject; });
  const key = crypto.randomBytes(16).toString('base64');
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  function fail(error) { if (closed) return; closed = true; rejectHandshake(error); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); child.stdin.destroy(); child.kill(); }
  const parser = new Frames(data => {
    let message; try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { throw new Error('invalid JSON message'); }
    if (message.id !== undefined && pending.has(message.id)) { const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
    else if (message.id !== undefined && message.method) throw new Error('unexpected server request: ' + message.method);
  }, (op, data) => { if (op === 9) child.stdin.write(frame(data, 10)); if (op === 8) fail(new Error('proxy closed connection')); });
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-1000); });
  child.on('error', fail); child.on('exit', (code, signal) => fail(new Error(`proxy exited ${code ?? signal}: ${stderr}`))); child.stdin.on('error', fail);
  child.stdout.on('data', chunk => { try {
    if (!ready) {
      buffer = Buffer.concat([buffer, chunk]); if (buffer.length > 16384) throw new Error('upgrade header too large');
      const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return;
      const lines = buffer.subarray(0, end).toString('ascii').split('\r\n');
      const headers = Object.fromEntries(lines.slice(1).map(line => { const i = line.indexOf(':'); return [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]; }));
      if (!/^HTTP\/1\.[01] 101(?: |$)/.test(lines[0]) || headers['sec-websocket-accept'] !== accept || !/^websocket$/i.test(headers.upgrade || '') || !/(?:^|,)\s*upgrade\s*(?:,|$)/i.test(headers.connection || '')) throw new Error('WebSocket upgrade rejected');
      ready = true; resolveHandshake(); chunk = buffer.subarray(end + 4); buffer = Buffer.alloc(0);
    }
    parser.push(chunk);
  } catch (error) { fail(error); } });
  const timer = setTimeout(() => fail(new Error('proxy handshake timeout: ' + stderr)), 12000);
  child.stdin.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  try { await handshake; } finally { clearTimeout(timer); }
  function request(method, params) { return new Promise((resolve, reject) => {
    if (closed) return reject(new Error('proxy closed'));
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    try { child.stdin.write(frame(JSON.stringify({ id, method, params }))); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  }); }
  let initialized;
  try { initialized = await request('initialize', { clientInfo: { name: 'ai-settings', version: '1.0' }, capabilities: { experimentalApi: true } }); child.stdin.write(frame(JSON.stringify({ method: 'initialized', params: {} }))); }
  catch (error) { fail(error); throw error; }
  return { request, userAgent: initialized?.userAgent, close() { fail(new Error('proxy closed')); } };
}
