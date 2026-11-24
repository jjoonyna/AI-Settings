import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
export function childEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([k])=>!/^CLAUDE_CODE_(MESSAGING|SESSION)_/i.test(k)));
}
export function messageRpc(env=process.env) {
  const child=spawn('nvim',['--headless','-u','NONE','-i','NONE','-l',fileURLToPath(new URL('./session-message-rpc.lua',import.meta.url))],
    {env:childEnvironment(env),windowsHide:true,stdio:['pipe','pipe','pipe']});
  let seq=0,closed=false,bytes=0;const pending=new Map();
  const fail=()=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('management RPC unavailable; no retry'));}pending.clear();};
  child.on('error',fail);child.on('exit',fail);child.stdin.on('error',fail);child.stderr.on('data',()=>{});
  readline.createInterface({input:child.stdout}).on('line',line=>{
    bytes+=Buffer.byteLength(line);if(Buffer.byteLength(line)>2*1024*1024||bytes>16*1024*1024){fail();child.stdin.end();return;}
    try{const v=JSON.parse(line),p=pending.get(v.id);if(p){clearTimeout(p.timer);pending.delete(v.id);p.resolve(v.result);}}catch{fail();}
  });
  return {request(request){return new Promise((resolve,reject)=>{
    if(closed||pending.size>=2)return reject(new Error('RPC unavailable'));
    const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(new Error('management response unknown; no retry'));},10000);
    pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,request})+'\n');
  });},close(){child.stdin.end();fail();child.stdout.destroy();child.stderr.destroy();child.unref();}};
}
