const express = require('express');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const BRIDGE_URL = process.env.BRIDGE_URL || '';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';

const TARGET_SUBS = Number(process.env.TARGET_SUBS || 100000);
const CURRENT_SUBS = process.env.CURRENT_SUBS ? Number(process.env.CURRENT_SUBS) : null;
const PLAN_START = Number(process.env.PLAN_START_TS || Date.now());
const PLAN_DAYS = Number(process.env.PLAN_DAYS || 365);

app.use(express.static(__dirname + '/public'));

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message || '').toString()));
      resolve((stdout || '').toString());
    });
  });
}

function safeJsonParse(v, fallback = {}) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

async function getBridgeStatus() {
  if (!BRIDGE_URL) throw new Error('BRIDGE_URL missing');
  const r = await fetch(BRIDGE_URL + '/status', {
    headers: { 'x-bridge-token': BRIDGE_TOKEN },
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || `bridge_http_${r.status}`);
  return j;
}

function summarizeMission() {
  const now = Date.now();
  const end = PLAN_START + PLAN_DAYS * 24 * 60 * 60 * 1000;
  const daysLeft = Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
  const subsLeft = CURRENT_SUBS == null ? null : Math.max(0, TARGET_SUBS - CURRENT_SUBS);
  const neededPerDay = subsLeft == null ? null : Number((subsLeft / Math.max(1, daysLeft)).toFixed(1));
  const progressPct = CURRENT_SUBS == null ? null : Number(((CURRENT_SUBS / TARGET_SUBS) * 100).toFixed(2));
  return {
    targetSubs: TARGET_SUBS,
    currentSubs: CURRENT_SUBS,
    planDays: PLAN_DAYS,
    daysLeft,
    neededPerDay,
    progressPct,
  };
}

app.get('/api/status', async (_req, res) => {
  try {
    let bridge = null;
    try {
      bridge = await getBridgeStatus();
    } catch {
      // graceful fallback to local status only
    }

    const out = await run('openclaw status --json');
    const status = safeJsonParse(out, {});
    const recent = (status?.sessions?.recent || []).slice(0, 6);

    res.json({
      ok: true,
      now: Date.now(),
      bridge,
      status,
      recent,
      mission: summarizeMission(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/cron', async (_req, res) => {
  try {
    const out = await run('openclaw cron list --json');
    const j = safeJsonParse(out, { jobs: [] });
    const jobs = (j.jobs || []).map((x) => {
      const state = x.state || {};
      return {
        id: x.id,
        name: x.name,
        enabled: !!x.enabled,
        schedule: x.schedule,
        nextRunAtMs: state.nextRunAtMs || null,
        lastRunAtMs: state.lastRunAtMs || null,
        lastStatus: state.lastStatus || '-',
        consecutiveErrors: state.consecutiveErrors || 0,
        delivery: x.delivery || {},
      };
    });

    const active = jobs.filter((j) => j.enabled).length;
    const errors = jobs.filter((j) => j.lastStatus === 'error' || j.consecutiveErrors > 0).length;

    res.json({ ok: true, now: Date.now(), active, errors, jobs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`dashboard listening ${PORT}`));
