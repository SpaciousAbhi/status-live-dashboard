const express = require('express');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const BRIDGE_URL = process.env.BRIDGE_URL || '';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || '';

const TARGET_SUBS = Number(process.env.TARGET_SUBS || 100000);
const CURRENT_SUBS = process.env.CURRENT_SUBS ? Number(process.env.CURRENT_SUBS) : null;
const PLAN_START = Number(process.env.PLAN_START_TS || Date.now());
const PLAN_DAYS = Number(process.env.PLAN_DAYS || 365);

app.use(express.json({ limit: '200kb' }));
app.use(express.static(__dirname + '/public'));

function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message || '').toString()));
      resolve((stdout || '').toString());
    });
  });
}

function safeJsonParse(v, fallback = {}) { try { return JSON.parse(v); } catch { return fallback; } }
function isUuid(v) { return /^[0-9a-fA-F-]{8,}$/.test(String(v || '')); }

async function detectOpenclaw() {
  try {
    const out = await run('command -v openclaw || true');
    return !!out.trim();
  } catch { return false; }
}

function requireControlAuth(req, res, next) {
  if (!DASHBOARD_TOKEN) return res.status(503).json({ ok: false, error: 'DASHBOARD_TOKEN not configured on server' });
  const incoming = req.headers['x-dashboard-token'] || '';
  if (incoming !== DASHBOARD_TOKEN) return res.status(401).json({ ok: false, error: 'unauthorized' });
  next();
}

async function getBridgeStatus() {
  if (!BRIDGE_URL) throw new Error('BRIDGE_URL missing');
  const r = await fetch(BRIDGE_URL + '/status', { headers: { 'x-bridge-token': BRIDGE_TOKEN } });
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
  return { targetSubs: TARGET_SUBS, currentSubs: CURRENT_SUBS, planDays: PLAN_DAYS, daysLeft, neededPerDay, progressPct };
}

function normalizeCronJobs(jobs) {
  return (jobs || []).map((x) => {
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
}

app.get('/api/status', async (_req, res) => {
  try {
    const openclawAvailable = await detectOpenclaw();

    let bridge = null;
    let bridgeError = null;
    try { bridge = await getBridgeStatus(); } catch (e) { bridgeError = String(e.message || e); }

    let status = {};
    let statusError = null;
    let recent = [];
    if (openclawAvailable) {
      try {
        const out = await run('openclaw status --json');
        status = safeJsonParse(out, {});
        recent = (status?.sessions?.recent || []).slice(0, 10);
      } catch (e) {
        statusError = String(e.message || e);
      }
    } else {
      statusError = 'openclaw CLI unavailable in this runtime';
    }

    const model = bridge?.model || status?.sessions?.defaults?.model || 'unknown';
    const payload = {
      ok: true,
      now: Date.now(),
      bridge,
      bridgeError,
      status,
      statusError,
      recent,
      mission: summarizeMission(),
      controlSecured: !!DASHBOARD_TOKEN,
      openclawAvailable,
      model,
    };

    res.json(payload);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/cron', async (_req, res) => {
  try {
    const openclawAvailable = await detectOpenclaw();
    if (!openclawAvailable) {
      return res.json({ ok: true, now: Date.now(), active: 0, errors: 0, jobs: [], warning: 'openclaw CLI unavailable in this runtime' });
    }
    const out = await run('openclaw cron list --json');
    const j = safeJsonParse(out, { jobs: [] });
    const jobs = normalizeCronJobs(j.jobs || []);
    const active = jobs.filter((j) => j.enabled).length;
    const errors = jobs.filter((j) => j.lastStatus === 'error' || j.consecutiveErrors > 0).length;
    res.json({ ok: true, now: Date.now(), active, errors, jobs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

async function guardControlRuntime(res) {
  const openclawAvailable = await detectOpenclaw();
  if (!openclawAvailable) {
    res.status(503).json({ ok: false, error: 'openclaw CLI unavailable in this runtime (control actions disabled)' });
    return false;
  }
  return true;
}

app.post('/api/control/cron/:id/run', requireControlAuth, async (req, res) => {
  try {
    if (!(await guardControlRuntime(res))) return;
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'invalid job id' });
    const out = await run(`openclaw cron run ${id}`);
    res.json({ ok: true, output: out.trim() || 'triggered' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/control/cron/:id/enable', requireControlAuth, async (req, res) => {
  try {
    if (!(await guardControlRuntime(res))) return;
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'invalid job id' });
    await run(`openclaw cron enable ${id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/control/cron/:id/disable', requireControlAuth, async (req, res) => {
  try {
    if (!(await guardControlRuntime(res))) return;
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'invalid job id' });
    await run(`openclaw cron disable ${id}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/control/gateway/restart', requireControlAuth, async (_req, res) => {
  try {
    if (!(await guardControlRuntime(res))) return;
    const out = await run('openclaw gateway restart');
    res.json({ ok: true, output: out.slice(0, 4000) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`dashboard listening ${PORT}`));
