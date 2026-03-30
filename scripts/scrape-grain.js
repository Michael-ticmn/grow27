// scripts/scrape-grain.js
// grow27 — grain cash bid scraper (orchestrator)
// Runs via GitHub Actions daily at 7am CT.
// Reads data/grain-config.json, writes data/prices/grain/<id>.json + data/prices/grain/index.json.
//
// Architecture:
//   This file handles the common loop (launch browser, delegate parse, write output).
//   Source-specific parsing lives in scripts/grain/<id>.js — each module exports
//   a parse({ id, config, browser }) function returning the standard result shape.
//   If no source-specific module exists, scripts/grain/_default.js is used.
//
// Deps: puppeteer (JS-rendered pages), cheerio (optional HTML parsing).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs   = require('fs');
const path = require('path');

// Lazy-require heavy deps — installed in GitHub Actions, not locally
let puppeteer;
function ensureDeps() {
  if (!puppeteer) puppeteer = require('puppeteer');
}

const ROOT        = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'grain-config.json');
const PRICES_DIR  = path.join(ROOT, 'data', 'prices', 'grain');
const INDEX_PATH  = path.join(PRICES_DIR, 'index.json');

// No history limit — keep all scrape dates (monitor file size as data grows)

// ── CBOT futures fetch (Yahoo Finance, Node 18+ built-in fetch) ─────────────

async function fetchCbot() {
  const tickers = { corn: 'ZC=F', beans: 'ZS=F' };
  const cbot = { corn: null, beans: null, fetchedAt: null };

  for (const [key, symbol] of Object.entries(tickers)) {
    try {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (grow27-bot)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const meta = j.chart.result[0].meta;
      // Yahoo returns cents/bushel for ZC and ZS (e.g. 458.25 for corn)
      const price = meta.regularMarketPrice;
      if (price != null) {
        // Convert cents → dollars to match our cash prices (e.g. 458.25 → 4.5825)
        cbot[key] = parseFloat((price / 100).toFixed(4));
      }
    } catch (e) {
      console.warn(`[cbot] ${key} (${symbol}) fetch failed: ${e.message}`);
    }
  }

  cbot.fetchedAt = new Date().toISOString();
  console.log(`[cbot] corn: ${cbot.corn != null ? '$' + cbot.corn : 'FAILED'}, beans: ${cbot.beans != null ? '$' + cbot.beans : 'FAILED'}`);
  return cbot;
}

// ── Basis calculation for cash-only sources ─────────────────────────────────

function fillCalculatedBasis(locations, cbot) {
  const ts = cbot.fetchedAt;
  let filled = 0;

  for (const [slug, locData] of Object.entries(locations)) {
    for (const commodity of ['corn', 'beans']) {
      const cbotPrice = cbot[commodity];
      if (cbotPrice == null) continue;
      const bids = locData[commodity];
      if (!Array.isArray(bids)) continue;

      for (const bid of bids) {
        if (bid.cash != null && bid.basis == null) {
          bid.basis = parseFloat((bid.cash - cbotPrice).toFixed(4));
          bid.basisNote = 'calculated ' + ts;
          filled++;
        }
      }
    }
  }

  return filled;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function trimHistory(history) {
  return history;
}

// ── Grain parser loader ──────────────────────────────────────────────────────

const GRAIN_DIR = path.join(__dirname, 'grain');

function loadGrainParser(id) {
  const specific = path.join(GRAIN_DIR, `${id}.js`);
  if (fs.existsSync(specific)) {
    console.log(`[${id}] using custom parser: grain/${id}.js`);
    return require(specific);
  }
  console.log(`[${id}] no custom parser found — using grain/_default.js`);
  return require(path.join(GRAIN_DIR, '_default.js'));
}

// ── Load / save helpers ──────────────────────────────────────────────────────

function loadGrainFile(id, name) {
  const p = path.join(PRICES_DIR, `${id}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`[${id}] loaded ${p} · history length: ${data.history.length}`);
    return data;
  } catch (e) {
    console.warn(`[${id}] could not load ${p} (${e.message}) — starting fresh`);
    return { id, name, lastUpdated: today(), lastSuccess: null, history: [] };
  }
}

function saveGrainFile(data) {
  const p = path.join(PRICES_DIR, `${data.id}.json`);
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
    console.log(`[${data.id}] wrote ${p} · history length: ${data.history.length}`);
  } catch (e) {
    console.error(`[${data.id}] WRITE FAILED: ${p} — ${e.message}`);
    throw e;
  }
}

// ── Trend helper ─────────────────────────────────────────────────────────────
// Compares most recent nearby corn cash price to the previous day's

function calcTrend(history, commodity = 'corn') {
  const good = [...history]
    .reverse()
    .filter(e => e.source === 'scraped' && e.locations && Object.keys(e.locations).length > 0);
  if (good.length < 2) return null;

  // Find first location with data in both entries
  for (const locKey of Object.keys(good[0].locations)) {
    const cur  = good[0].locations[locKey]?.[commodity]?.[0]?.cash;
    const prev = good[1].locations[locKey]?.[commodity]?.[0]?.cash;
    if (cur != null && prev != null) {
      const diff = cur - prev;
      if (diff >  0.005) return 'up';
      if (diff < -0.005) return 'down';
      return 'flat';
    }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const todayStr = today();
  console.log(`\n=== grow27 grain scraper · ${todayStr} ===`);
  console.log(`ROOT: ${ROOT}`);
  console.log(`CONFIG: ${CONFIG_PATH}`);
  console.log(`PRICES_DIR: ${PRICES_DIR}\n`);

  // Ensure output directory exists
  if (!fs.existsSync(PRICES_DIR)) {
    fs.mkdirSync(PRICES_DIR, { recursive: true });
    console.log(`Created ${PRICES_DIR}`);
  }

  const grainConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  console.log(`Loaded config · ${grainConfig.length} sources\n`);

  // Fetch CBOT nearby futures for basis calculation on cash-only sources
  const cbot = await fetchCbot();

  const indexOut = [];

  for (const config of grainConfig) {
    const { id, name } = config;

    if (config.disabled) {
      console.log(`\n════ ${id} (${name}) ════ SKIPPED — ${config.disabledReason || 'disabled'}`);
      continue;
    }

    console.log(`\n════ ${id} (${name}) ════`);

    const grainData = loadGrainFile(id, name);
    const parser = loadGrainParser(id);

    let browser;
    try {
      ensureDeps();
      console.log(`[${id}] launching Puppeteer...`);
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const result = await parser.parse({ id, config, browser });

      // Fill calculated basis for sources that only provide cash prices
      const locs = result.locations ?? {};
      const basisFilled = fillCalculatedBasis(locs, cbot);
      if (basisFilled > 0) {
        console.log(`[${id}] filled calculated basis on ${basisFilled} bids (CBOT corn: ${cbot.corn}, beans: ${cbot.beans})`);
      }

      const entry = {
        date:      todayStr,
        scrapedAt: new Date().toISOString(),
        locations: locs,
        source:    result.source ?? 'scraped',
      };
      if (result.error) entry.error = result.error;
      if (result.source === 'scraped') grainData.lastSuccess = todayStr;

      const locCount = Object.keys(entry.locations).length;
      const firstLoc = locCount > 0 ? Object.keys(entry.locations)[0] : 'none';
      console.log(`[${id}] entry: ${locCount} locations scraped (first: ${firstLoc})`);

      // Dedup by date, then append
      grainData.history = trimHistory(grainData.history)
        .filter(e => e.date !== todayStr);
      grainData.history.push(entry);

    } catch (err) {
      console.error(`[${id}] SCRAPE FAILED: ${err.message}`);
      const entry = {
        date:      todayStr,
        locations: {},
        source:    'fetch_failed',
        error:     err.message,
      };
      grainData.history = trimHistory(grainData.history)
        .filter(e => e.date !== todayStr);
      grainData.history.push(entry);
    } finally {
      if (browser) await browser.close();
    }

    grainData.lastUpdated = todayStr;
    saveGrainFile(grainData);

    indexOut.push(buildIndexRow(grainData, config));
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexOut, null, 2) + '\n');
  console.log('\n=== grain index.json updated ===');

  // ── File size warning ───────────────────────────────────────────────────
  checkFileSizes(PRICES_DIR, 5);
}

// ── File size monitor ────────────────────────────────────────────────────────

function checkFileSizes(dir, thresholdMB) {
  const threshold = thresholdMB * 1024 * 1024;
  let warned = false;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const fp = path.join(dir, file);
    const stat = fs.statSync(fp);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
    if (stat.size > threshold) {
      console.warn(`⚠ SIZE WARNING: ${file} is ${sizeMB} MB (threshold: ${thresholdMB} MB)`);
      warned = true;
    }
  }
  if (!warned) console.log(`File sizes OK (all under ${thresholdMB} MB)`);
}

// ── Build index row from history ─────────────────────────────────────────────

function buildIndexRow(grainData, config) {
  const recent = [...grainData.history]
    .reverse()
    .find(e => e.source === 'scraped' && Object.keys(e.locations).length > 0);

  return {
    id:          config.id,
    name:        config.name,
    url:         config.url,
    lastSuccess: grainData.lastSuccess,
    date:        recent?.date ?? null,
    scrapedAt:   recent?.scrapedAt ?? null,
    locations:   recent?.locations ?? {},
    trend:       calcTrend(grainData.history),
    source:      recent?.source ?? 'pending',
  };
}

// ── Run if executed directly ─────────────────────────────────────────────────

if (require.main === module) {
  run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
