// scripts/scrape-futures-history.js
// Fetches historical futures data from Yahoo Finance and writes to data/prices/futures-history.json
// Zero external dependencies — uses Node 18+ built-in fetch.
// Run daily after market close via .github/workflows/scrape-futures.yml
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs   = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, '..', 'data', 'prices', 'futures-history.json');

// 5-year daily data for charts (7D through 5Y range selection on frontend)
const DAILY_TICKERS = {
  LE: 'LE=F',   // Live Cattle
  GF: 'GF=F',   // Feeder Cattle
  ZC: 'ZC=F',   // Corn
  ZS: 'ZS=F',   // Soybeans
  DC: 'DC=F',   // Class III Milk
  ZM: 'ZM=F',   // Soybean Meal
};

// 5-year monthly data for seasonal analysis
const MONTHLY_TICKERS = {
  LE: 'LE=F',   // Live Cattle seasonal
};

async function fetchChart(symbol, range, interval, retries = 2) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (grow27-bot)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const res = j.chart.result[0];
      const timestamps = res.timestamp || [];
      const closes = res.indicators.quote[0].close || [];
      // Filter out null closes
      const clean = { timestamps: [], closes: [] };
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] != null) {
          clean.timestamps.push(timestamps[i]);
          clean.closes.push(parseFloat(closes[i].toFixed(4)));
        }
      }
      return clean;
    } catch (e) {
      console.warn(`[futures] ${symbol} ${range}/${interval} attempt ${attempt + 1} failed:`, e.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

async function run() {
  console.log('[futures] fetching historical data from Yahoo Finance...');
  const output = {
    updated: new Date().toISOString(),
    daily: {},
    monthly: {},
  };

  // Fetch daily data (6mo, 1d interval)
  for (const [key, sym] of Object.entries(DAILY_TICKERS)) {
    console.log(`[futures] daily: ${key} (${sym})...`);
    const data = await fetchChart(sym, '5y', '1d');
    if (data) {
      output.daily[key] = data;
      console.log(`[futures]   ✓ ${data.closes.length} points`);
    } else {
      output.daily[key] = null;
      console.error(`[futures]   ✗ FAILED`);
    }
    // Brief pause between requests
    await new Promise(r => setTimeout(r, 500));
  }

  // Fetch monthly data (5y, 1mo interval)
  for (const [key, sym] of Object.entries(MONTHLY_TICKERS)) {
    console.log(`[futures] monthly: ${key} (${sym})...`);
    const data = await fetchChart(sym, '5y', '1mo');
    if (data) {
      output.monthly[key] = data;
      console.log(`[futures]   ✓ ${data.closes.length} points`);
    } else {
      output.monthly[key] = null;
      console.error(`[futures]   ✗ FAILED`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Write output
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  const size = (fs.statSync(OUT_FILE).size / 1024).toFixed(1);
  console.log(`[futures] wrote ${OUT_FILE} (${size} KB)`);

  // Summary
  const dailyOk = Object.values(output.daily).filter(Boolean).length;
  const monthlyOk = Object.values(output.monthly).filter(Boolean).length;
  console.log(`[futures] done: ${dailyOk}/${Object.keys(DAILY_TICKERS).length} daily, ${monthlyOk}/${Object.keys(MONTHLY_TICKERS).length} monthly`);
}

run().catch(e => { console.error('[futures] fatal:', e); process.exit(1); });
