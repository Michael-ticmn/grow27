// scripts/robots-check.js
// Two modes:
//   1. checkAll() — midnight job fetches robots.txt for every source, writes robots-log.json
//   2. isAllowed() — scrapers read the log to decide whether to scrape (no network call)

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'data', 'robots-log.json');

// ── Fetch robots.txt ────────────────────────────────────────────────────────
function fetchRobotsTxt(siteUrl, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(siteUrl);
      const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
      const client = u.protocol === 'https:' ? https : http;

      const req = client.get(robotsUrl, { timeout: timeoutMs }, (res) => {
        if (res.statusCode === 404 || res.statusCode === 410) {
          resolve({ found: false, body: '', status: res.statusCode });
          return;
        }
        if (res.statusCode !== 200) {
          resolve({ found: false, body: '', status: res.statusCode });
          return;
        }
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => resolve({ found: true, body, status: 200 }));
      });

      req.on('error', () => resolve({ found: false, body: '', status: 0 }));
      req.on('timeout', () => { req.destroy(); resolve({ found: false, body: '', status: 0 }); });
    } catch (e) {
      resolve({ found: false, body: '', status: 0 });
    }
  });
}

// ── Parse robots.txt ────────────────────────────────────────────────────────
function isDisallowed(robotsTxt, urlPath) {
  const lines = robotsTxt.split('\n').map(l => l.trim());
  let inWildcard = false;
  let blocked = false;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.startsWith('user-agent:')) {
      const agent = lower.slice(11).trim();
      inWildcard = (agent === '*');
      continue;
    }

    if (!inWildcard) continue;

    if (lower.startsWith('disallow:')) {
      const disPath = line.slice(9).trim();
      if (!disPath) continue;
      if (urlPath.startsWith(disPath) || disPath === '/') blocked = true;
    }

    if (lower.startsWith('allow:')) {
      const allowPath = line.slice(6).trim();
      if (urlPath.startsWith(allowPath)) blocked = false;
    }
  }

  return blocked;
}

// ── Log I/O ─────────────────────────────────────────────────────────────────
function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')); }
  catch { return {}; }
}

function saveLog(log) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + '\n');
}

// ── Mode 1: Midnight check — fetch robots.txt for a single source ────────
async function checkOne(sourceId, scrapeUrl) {
  const checkedAt = new Date().toISOString();
  let allowed = true;
  let reason = '';

  try {
    const u = new URL(scrapeUrl);
    const { found, body, status } = await fetchRobotsTxt(scrapeUrl);

    if (!found) {
      reason = status === 404 ? 'no robots.txt (404)' :
               status === 0   ? 'robots.txt unreachable' :
               `robots.txt HTTP ${status}`;
    } else if (isDisallowed(body, u.pathname)) {
      allowed = false;
      reason = 'disallowed by robots.txt';
    } else {
      reason = 'allowed by robots.txt';
    }
  } catch (e) {
    reason = 'check error: ' + e.message;
  }

  const icon = allowed ? '✓' : '✗';
  console.log(`[robots] ${icon} ${sourceId}: ${reason}`);

  return { allowed, reason, checkedAt };
}

// Check all sources and write robots-log.json
async function checkAll(sources) {
  const log = loadLog();

  for (const src of sources) {
    if (!src.url) continue;
    const result = await checkOne(src.id, src.url);
    log[src.id] = {
      url: src.url,
      active: src.active !== false,
      ...result,
    };
    if (src.note) log[src.id].note = src.note;
  }

  saveLog(log);
  console.log(`[robots] log saved — ${Object.keys(log).length} sources checked`);
  return log;
}

// ── Mode 2: Scraper reads last known result (no network call) ────────────
function isAllowed(sourceId) {
  const log = loadLog();
  const entry = log[sourceId];

  if (!entry) {
    // Never checked — allow (fail open), but warn
    console.log(`[robots] ⚠ ${sourceId}: no prior check — allowing`);
    return true;
  }

  if (!entry.allowed) {
    console.log(`[robots] ✗ ${sourceId}: blocked since ${entry.checkedAt} — ${entry.reason}`);
    return false;
  }

  console.log(`[robots] ✓ ${sourceId}: allowed (checked ${entry.checkedAt})`);
  return true;
}

// ── Watchlist: sources we tried that blocked us ─────────────────────────────
// These are checked daily even though we don't actively scrape them.
// If they ever unblock, the log will show allowed and we can add a parser.
const WATCHLIST = [
  { id: 'dtn-cashbids',        url: 'https://www.dtnpf.com/agriculture/web/ag/grains/local-grain-prices', note: 'DTN Progressive Farmer — local cash bids widget used by many elevators' },
  { id: 'cmegroup-corn',       url: 'https://www.cmegroup.com/markets/agriculture/grains/corn.html', note: 'CME Group — official CBOT corn futures' },
  { id: 'cmegroup-soybeans',   url: 'https://www.cmegroup.com/markets/agriculture/oilseeds/soybean.html', note: 'CME Group — official CBOT soybean futures' },
  { id: 'aghost-jennieo',      url: 'https://jennieo.aghostportal.com/index.cfm?show=11&mid=3&theLocation=4&layout=1046', note: 'Jennie-O AgHost portal — direct bid page, robots.txt blocks scrapers' },
];

// ── CLI: node robots-check.js  (runs checkAll for all configured sources) ─
if (require.main === module) {
  (async () => {
    const grainConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'grain-config.json'), 'utf-8'));
    const barnsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'barns-config.json'), 'utf-8'));

    const sources = [];

    // Active sources
    for (const g of grainConfig) {
      if (g.disabled) continue;
      if (g.url) sources.push({ id: g.id, url: g.url, active: true });
    }
    for (const b of barnsConfig) {
      const url = b.reports?.[0]?.url || b.reportUrl;
      if (url) sources.push({ id: b.id, url, active: true });
    }

    // Watchlist (previously blocked or attempted)
    for (const w of WATCHLIST) {
      sources.push({ id: w.id, url: w.url, active: false, note: w.note });
    }

    const log = await checkAll(sources);

    // Report any watchlist changes
    for (const w of WATCHLIST) {
      const entry = log[w.id];
      if (entry && entry.allowed) {
        console.log(`\n🔔 WATCHLIST ALERT: ${w.id} is now ALLOWED — ${w.note}`);
      }
    }
  })();
}

module.exports = { checkAll, isAllowed };
