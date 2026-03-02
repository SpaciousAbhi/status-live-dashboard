const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const BRIDGE_URL = process.env.BRIDGE_URL || '';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
app.use(express.static(__dirname + '/public'));

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

app.listen(PORT, () => console.log(`listening ${PORT}`));
