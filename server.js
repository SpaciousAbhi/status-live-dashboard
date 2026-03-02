const express = require('express');
const { exec } = require('child_process');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname + '/public'));
function run(cmd){return new Promise((res,rej)=>exec(cmd,{maxBuffer:1024*1024},(e,so,se)=>e?rej(se||so):res(so)));}
app.get('/api/status', async (_req, resp)=>{
  try {
    const out = await run('openclaw session-status --json 2>/dev/null || true');
    let j={}; try{ j=JSON.parse(out);}catch{}
    const model = j?.model?.id || j?.model || 'unknown';
    const sessionLeft = j?.usage?.session?.remainingPercent ?? null;
    const dayLeft = j?.usage?.day?.remainingPercent ?? null;
    resp.json({ok:true, model, sessionLeft, dayLeft, raw:j});
  } catch (e) {
    resp.json({ok:false,error:String(e)});
  }
});
app.listen(PORT, ()=>console.log('listening '+PORT));
