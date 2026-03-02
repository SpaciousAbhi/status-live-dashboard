const express = require('express');
const { exec } = require('child_process');
const app = express();
const PORT = process.env.PORT || 3000;
const BRIDGE_URL = process.env.BRIDGE_URL || '';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
app.use(express.static(__dirname + '/public'));

function run(cmd){return new Promise((res,rej)=>exec(cmd,{maxBuffer:4*1024*1024},(e,so,se)=>e?rej(new Error((se||so||e.message).toString())):res((so||'').toString())))}

async function getBridgeStatus() {
  const r = await fetch(BRIDGE_URL + '/status', { headers: { 'x-bridge-token': BRIDGE_TOKEN } });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `bridge_http_${r.status}`);
  return j;
}

app.get('/api/status', async (_req, res) => {
  try {
    if (!BRIDGE_URL) throw new Error('BRIDGE_URL missing');
    const j = await getBridgeStatus();
    res.json({ ...j, availableModels: [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/agents', async (_req,res)=>{
  try{
    const out = await run('openclaw sessions --json');
    const j = JSON.parse(out);
    const items = (j.sessions||[]).filter(s=>String(s.key||'').includes('subagent') || String(s.key||'').includes('telegram:direct')).slice(0,8)
      .map(s=>({key:s.key, model:s.model||'unknown', ageMs:s.ageMs||0, updatedAt:s.updatedAt||0, tokens:s.totalTokens||0}));
    res.json({ok:true, now:Date.now(), agents:items});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)});} 
});

app.listen(PORT, () => console.log(`listening ${PORT}`));
