const express = require('express');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(__dirname + '/public'));

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message).toString()));
      resolve((stdout || '').toString());
    });
  });
}

let modelsCache = { at: 0, data: [] };
async function getModels() {
  const now = Date.now();
  if (now - modelsCache.at < 5 * 60 * 1000) return modelsCache.data;
  try {
    const out = await run('openclaw models list --json 2>/dev/null || echo "[]"');
    const arr = JSON.parse(out);
    const names = (arr || []).map(x => x.id || x.model || x.name).filter(Boolean);
    modelsCache = { at: now, data: names.slice(0, 25) };
  } catch {
    modelsCache = { at: now, data: [] };
  }
  return modelsCache.data;
}

app.get('/api/status', async (_req, res) => {
  try {
    const out = await run('openclaw status --json');
    const j = JSON.parse(out);

    const recent = (j?.sessions?.recent || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const current = recent.find(x => x?.key?.includes('telegram:direct:1654334233')) || recent[0] || {};

    const model = current.model || j?.sessions?.defaults?.model || 'unknown';
    const contextTokens = Number(current.contextTokens || j?.sessions?.defaults?.contextTokens || 0);
    const inputTokens = Number(current.inputTokens || 0);
    const percentUsed = Number(current.percentUsed || 0);
    const remaining = Number(current.remainingTokens || Math.max(contextTokens - inputTokens, 0));

    const models = await getModels();

    res.json({
      ok: true,
      now: Date.now(),
      model,
      contextTokens,
      inputTokens,
      remaining,
      percentUsed,
      availableModels: models,
      channelSummary: j?.channelSummary || [],
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`listening ${PORT}`));
