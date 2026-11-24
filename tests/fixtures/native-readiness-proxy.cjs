// Synthetic stdio native proxy for CLI regression; no real socket, model, auth, or provider.
const fs=require('node:fs'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),{fileURLToPath}=require('node:url');
const control=JSON.parse(fs.readFileSync(process.env.AI_SETTINGS_TEST_NATIVE,'utf8'));
const stateFile=control.state;
const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));state.attempts++;fs.writeFileSync(stateFile,JSON.stringify(state));
if(state.attempts<=(control.notReady||0)||(control.failOnAttempts||[]).includes(state.attempts)) {
  process.stderr.write('Error: failed to connect to socket at '+control.socket+'\n\nCaused by:\n    missing socket (os error '+(control.osError||2)+')\n');process.exitCode=1;
} else {
  let header=true,pending=Buffer.alloc(0);
  const send=value=>{const bytes=Buffer.from(JSON.stringify(value)),h=Buffer.alloc(bytes.length<126?2:bytes.length<=65535?4:10);h[0]=0x81;
    if(h.length===2)h[1]=bytes.length;else if(h.length===4){h[1]=126;h.writeUInt16BE(bytes.length,2);}else{h[1]=127;h.writeBigUInt64BE(BigInt(bytes.length),2);}process.stdout.write(Buffer.concat([h,bytes]));};
  async function request(m) {
    if(m.id===undefined)return;
    const s=JSON.parse(fs.readFileSync(stateFile,'utf8'));s.methods.push(m.method);
    if(m.method==='thread/start'||(m.method==='thread/resume'&&m.params.config))s.mcp=m.params.config['mcp_servers.ai_settings_sessions'].env;
    fs.writeFileSync(stateFile,JSON.stringify(s));
    let result;
    if(m.method==='initialize')result={userAgent:control.badVersion?'codex/0.0.0':'codex/0.172.0'};
    else if(m.method==='thread/name/set')result={};
    else if(m.method==='thread/start'||m.method==='thread/resume')result={thread:{id:control.id},model:'gpt-6.1-sol',cwd:control.cwd,approvalPolicy:'on-request',approvalsReviewer:'auto_review',sandbox:{type:'workspaceWrite'}};
    else if(m.method==='mcpServerStatus/list') {
      const env={...process.env,...s.mcp};for(const k of ['CODEX_THREAD_ID','CODEX_SESSION_ID','AI_SETTINGS_MCP_THREAD_ID'])delete env[k];
      const input=[{id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}},{method:'notifications/initialized'},{id:2,method:'tools/list'}].map(v=>JSON.stringify({jsonrpc:'2.0',...v})).join('\n')+'\n';
      const r=spawnSync(process.execPath,[fileURLToPath(control.toolsURL)],{env,input,encoding:'utf8'});if(r.status!==0)throw Error('synthetic catalog unavailable');
      const c=JSON.parse(r.stdout.trim().split('\n').at(-1)).result;
      result={data:[{name:'ai_settings_sessions',authStatus:'unsupported',runtimeStatus:'connected',serverInfo:{name:'ai-settings-sessions',version:'0.1.0'},serverCapabilities:{tools:{}},toolsError:null,
        resources:[],resourceTemplates:[],tools:Object.fromEntries(c.tools.map(t=>[t.name,t])),toolListMeta:c._meta}],nextCursor:null};
    } else throw Error('unexpected synthetic operation');
    send({id:m.id,result});
  }
  process.stdin.on('data',chunk=>{
    pending=Buffer.concat([pending,chunk]);
    if(header) {
      const at=pending.indexOf('\r\n\r\n');if(at<0)return;
      const key=/Sec-WebSocket-Key: ([^\r]+)/.exec(pending.subarray(0,at).toString())[1];
      const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      process.stdout.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
      pending=pending.subarray(at+4);header=false;
    }
    while(pending.length>=2) {
      let n=pending[1]&127,offset=2;if(n===126){if(pending.length<4)return;n=pending.readUInt16BE(2);offset=4;}
      else if(n===127){if(pending.length<10)return;n=Number(pending.readBigUInt64BE(2));offset=10;}
      if(pending.length<offset+4+n)return;const mask=pending.subarray(offset,offset+4),body=Buffer.from(pending.subarray(offset+4,offset+4+n));
      for(let i=0;i<body.length;i++)body[i]^=mask[i%4];pending=pending.subarray(offset+4+n);request(JSON.parse(body.toString())).catch(()=>{process.exitCode=1;process.stdin.destroy();});
    }
  });
}
