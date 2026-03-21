// scripts/scrape-barns.js
// grow27 — auction barn price scraper
// Runs via GitHub Actions daily at 7am CT.
// Reads data/barns-config.json, writes data/prices/<id>.json + data/prices/index.json.
// Deps: cheerio (HTML parsing), puppeteer (JS-rendered pages).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs        = require('fs');
const path      = require('path');
const cheerio   = require('cheerio');
const puppeteer = require('puppeteer');

const ROOT         = path.join(__dirname, '..');
const CONFIG_PATH  = path.join(ROOT, 'data', 'barns-config.json');
const PRICES_DIR   = path.join(ROOT, 'data', 'prices');
const INDEX_PATH   = path.join(PRICES_DIR, 'index.json');

const MAX_HISTORY  = 14;
const MAX_AGE_DAYS = 14;

const SLAUGHTER_DISC = { beef: 0, crossbred: 9.50, holstein: 30.00 };
const FEEDER_FACTOR  = 0.40;

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function trimHistory(history) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  const cutStr = cutoff.toISOString().slice(0, 10);
  return history.filter(e => e.date >= cutStr).slice(-MAX_HISTORY);
}

function norm(text) {
  return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

function midpoint(text) {
  const range = text.match(/(\d{2,3}(?:\.\d+)?)\s*(?:[-–]|to)\s*(\d{2,3}(?:\.\d+)?)/);
  if (range) return (parseFloat(range[1]) + parseFloat(range[2])) / 2;
  const single = text.match(/(\d{2,3}(?:\.\d+)?)/);
  if (single) return parseFloat(single[1]);
  return null;
}

function extractPrice(text, minVal = 150, maxVal = 400) {
  const v = midpoint(text);
  return (v !== null && v >= minVal && v <= maxVal) ? parseFloat(v.toFixed(2)) : null;
}

// ── Puppeteer fetch (handles JS-rendered pages) ─────────────────────────────

async function fetchRenderedHtml(url) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  const html = await page.content();
  await browser.close();
  return html;
}

// ── HTML scraper ─────────────────────────────────────────────────────────────

async function scrapeBarns(config) {
  const { id, reportUrl, parseRules } = config;

  // ── 1. Fetch rendered HTML via Puppeteer ────────────────────────────────
  let html;
  try {
    console.log(`[${id}] launching Puppeteer for: ${reportUrl}`);
    html = await fetchRenderedHtml(reportUrl);
    console.log(`[${id}] fetch OK · ${html.length} bytes`);
    console.log(`[${id}] HTML preview:\n${html.slice(0, 500)}\n`);
    if (html.length < 500) throw new Error('response too short — likely blocked or empty');
  } catch (fetchErr) {
    console.error(`[${id}] FETCH FAILED: ${fetchErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: fetchErr.message };
  }

  // ── Parse ────────────────────────────────────────────────────────────────
  try {
    const $ = cheerio.load(html);
    const slaughter = { beef: null, crossbred: null, holstein: null };
    const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };

    const cells = [];
    $('td, th').each((i, el) => {
      cells.push({ i, text: $(el).text().replace(/\s+/g, ' ').trim() });
    });
    console.log(`[${id}] total td/th cells found: ${cells.length}`);

    if (cells.length === 0) {
      // Page likely JS-rendered — dump the raw HTML to help diagnose
      console.warn(`[${id}] WARNING: zero cells found — page may be JS-rendered (Wix/React)`);
      console.log(`[${id}] full HTML (first 2000 chars):\n${html.slice(0, 2000)}`);
    }

    function priceAfter(headerIdx, minVal = 150, maxVal = 400) {
      for (let j = headerIdx + 1; j < Math.min(headerIdx + 12, cells.length); j++) {
        const p = extractPrice(cells[j].text, minVal, maxVal);
        if (p !== null) return p;
      }
      return null;
    }

    // ── 4a. Slaughter parsing ─────────────────────────────────────────────
    console.log(`[${id}] --- slaughter headers ---`);
    for (const [type, label] of Object.entries(parseRules.slaughter)) {
      const target = norm(label);
      const headerIdx = cells.findIndex(c => norm(c.text).includes(target));
      if (headerIdx === -1) {
        console.warn(`[${id}] slaughter.${type}: header NOT FOUND ("${label}")`);
        continue;
      }
      console.log(`[${id}] slaughter.${type}: header found at cell[${headerIdx}] = "${cells[headerIdx].text}"`);
      // Log next 5 cells so we can see what the price scanner sees
      const nearby = cells.slice(headerIdx + 1, headerIdx + 6).map(c => `"${c.text}"`).join(', ');
      console.log(`[${id}] slaughter.${type}: next 5 cells = [${nearby}]`);
      const price = priceAfter(headerIdx);
      if (price !== null) {
        slaughter[type] = price;
        console.log(`[${id}] slaughter.${type} = ${price} ✓`);
      } else {
        console.warn(`[${id}] slaughter.${type}: NO PRICE extracted from nearby cells`);
      }
    }

    // ── 4b. Feeder parsing ────────────────────────────────────────────────
    console.log(`[${id}] --- feeder headers ---`);
    for (const [type, labelPrefix] of Object.entries(parseRules.feeder)) {
      const target = norm(labelPrefix);
      const headerIdx = cells.findIndex(c => {
        const base = norm(c.text).replace(/\s*[-–]\s*lite\s*test.*$/, '').trim();
        return base.startsWith(target);
      });
      if (headerIdx === -1) {
        console.warn(`[${id}] feeder.${type}: header NOT FOUND (prefix "${labelPrefix}")`);
        continue;
      }
      console.log(`[${id}] feeder.${type}: header found at cell[${headerIdx}] = "${cells[headerIdx].text}"`);
      const nearby = cells.slice(headerIdx + 1, headerIdx + 6).map(c => `"${c.text}"`).join(', ');
      console.log(`[${id}] feeder.${type}: next 5 cells = [${nearby}]`);
      const price = priceAfter(headerIdx, 100, 500);
      if (price !== null) {
        if (type === 'beef')     feeder.beef    = price;
        if (type === 'holstein') feeder.holstein = price;
        if (norm(cells[headerIdx].text).includes('lite')) feeder.liteTest = true;
        console.log(`[${id}] feeder.${type} = ${price} ✓${feeder.liteTest ? ' [liteTest]' : ''}`);
      } else {
        console.warn(`[${id}] feeder.${type}: NO PRICE extracted from nearby cells`);
      }
    }

    if (feeder.beef !== null) {
      feeder.crossbred = parseFloat(
        (feeder.beef - SLAUGHTER_DISC.crossbred * FEEDER_FACTOR).toFixed(2)
      );
      console.log(`[${id}] feeder.crossbred = ${feeder.crossbred} (derived from beef)`);
    }

    const hasSlaughter = Object.values(slaughter).some(v => v !== null);
    const hasFeeder    = feeder.beef !== null || feeder.holstein !== null;
    console.log(`[${id}] parse result — hasSlaughter=${hasSlaughter} hasFeeder=${hasFeeder}`);

    if (!hasSlaughter && !hasFeeder) {
      throw new Error('zero prices extracted — page structure may have changed');
    }

    return { slaughter, feeder, source: 'scraped', error: null };

  } catch (parseErr) {
    console.error(`[${id}] PARSE ERROR: ${parseErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: parseErr.message };
  }
}

// ── Null entry builder ────────────────────────────────────────────────────────

function nullEntry(dateStr, source = 'pending') {
  return {
    date: dateStr,
    slaughter: { beef: null, crossbred: null, holstein: null },
    feeder:    { beef: null, crossbred: null, holstein: null, liteTest: false },
    source,
  };
}

// ── Load / save helpers ───────────────────────────────────────────────────────

function loadBarnFile(id, name, location) {
  const p = path.join(PRICES_DIR, `${id}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`[${id}] loaded ${p} · history length: ${data.history.length}`);
    return data;
  } catch (e) {
    console.warn(`[${id}] could not load ${p} (${e.message}) — starting fresh`);
    return { id, name, location, lastUpdated: today(), lastSuccess: null, history: [] };
  }
}

function saveBarnFile(data) {
  const p = path.join(PRICES_DIR, `${data.id}.json`);
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
    // ── 5. Confirm write ──────────────────────────────────────────────────
    console.log(`[${data.id}] wrote ${p} · history length: ${data.history.length}`);
  } catch (e) {
    console.error(`[${data.id}] WRITE FAILED: ${p} — ${e.message}`);
    throw e;
  }
}

// ── Trend helper ──────────────────────────────────────────────────────────────

function calcTrend(history) {
  const good = [...history]
    .reverse()
    .filter(e => (e.source === 'scraped' || e.source === 'calculated') && e.slaughter?.beef != null);
  if (good.length < 2) return null;
  const diff = good[0].slaughter.beef - good[1].slaughter.beef;
  if (diff >  0.5) return 'up';
  if (diff < -0.5) return 'down';
  return 'flat';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const todayStr = today();
  console.log(`\n=== grow27 barn scraper · ${todayStr} ===`);
  console.log(`ROOT: ${ROOT}`);
  console.log(`CONFIG: ${CONFIG_PATH}`);
  console.log(`PRICES_DIR: ${PRICES_DIR}\n`);

  const barnsConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  console.log(`Loaded config · ${barnsConfig.length} barns\n`);

  const indexOut = [];

  for (const config of barnsConfig) {
    const { id, name, location } = config;
    console.log(`\n════ ${id} (${name}) ════`);

    // ── 1. Load existing file ─────────────────────────────────────────────
    const barnData = loadBarnFile(id, name, location);

    let entry;
    if (config.hasTypeBreakdown && config.reportUrl) {
      // ── 2. Attempt live scrape ──────────────────────────────────────────
      const result = await scrapeBarns(config);
      entry = {
        date:      todayStr,
        slaughter: result.slaughter ?? { beef: null, crossbred: null, holstein: null },
        feeder:    result.feeder    ?? { beef: null, crossbred: null, holstein: null, liteTest: false },
        source:    result.source,
      };
      if (result.error) entry.error = result.error;
      if (result.source === 'scraped') barnData.lastSuccess = todayStr;
    } else {
      // hasTypeBreakdown is false — calculate discounted prices from beef baseline
      // No type breakdown — calculate from the most recent beef baseline
      // Find the latest scraped beef slaughter price across all barns processed so far
      let beefBase = null;
      for (const idx of indexOut) {
        if (idx.slaughter?.beef != null) { beefBase = idx.slaughter.beef; break; }
      }
      // Fallback: check this barn's own history for a prior scraped beef price
      if (beefBase === null) {
        const prior = [...barnData.history]
          .reverse()
          .find(e => (e.source === 'scraped' || e.source === 'calculated') && e.slaughter?.beef != null);
        if (prior) beefBase = prior.slaughter.beef;
      }

      if (beefBase !== null) {
        // Feeder baseline: use most recent scraped feeder beef, or fall back to CME feeder price
        let feederBase = null;
        for (const idx of indexOut) {
          if (idx.feeder?.beef != null) { feederBase = idx.feeder.beef; break; }
        }
        if (feederBase === null) {
          const priorF = [...barnData.history]
            .reverse()
            .find(e => (e.source === 'scraped' || e.source === 'calculated') && e.feeder?.beef != null);
          if (priorF) feederBase = priorF.feeder.beef;
        }

        entry = {
          date: todayStr,
          slaughter: {
            beef:      parseFloat(beefBase.toFixed(2)),
            crossbred: parseFloat((beefBase - 9.50).toFixed(2)),
            holstein:  parseFloat((beefBase - 30.00).toFixed(2)),
          },
          feeder: {
            beef:      feederBase != null ? parseFloat(feederBase.toFixed(2)) : null,
            crossbred: feederBase != null ? parseFloat((feederBase - 3.80).toFixed(2)) : null,
            holstein:  feederBase != null ? parseFloat((feederBase - 12.00).toFixed(2)) : null,
            liteTest:  false,
          },
          source: 'calculated',
        };
        console.log(`[${id}] calculated from beef baseline: slaughter=${beefBase}, feeder=${feederBase}`);
      } else {
        // No baseline available yet — write pending entry
        entry = nullEntry(todayStr, 'pending');
        console.log(`[${id}] no beef baseline available — writing pending entry`);
      }
    }

    console.log(`[${id}] entry to append: ${JSON.stringify(entry)}`);

    // Trim then append — never duplicate same-date entries
    barnData.history = trimHistory(barnData.history).filter(e => e.date !== todayStr);
    barnData.history.push(entry);
    barnData.lastUpdated = todayStr;

    // ── 5. Save ───────────────────────────────────────────────────────────
    saveBarnFile(barnData);

    // Build index row from most-recent successful entry
    const recent = [...barnData.history]
      .reverse()
      .find(e => e.source === 'scraped' || e.source === 'calculated');

    indexOut.push({
      id,
      name,
      location,
      lastSuccess: barnData.lastSuccess,
      slaughter:  recent?.slaughter ?? { beef: null, crossbred: null, holstein: null },
      feeder:     recent?.feeder    ?? { beef: null, crossbred: null, holstein: null, liteTest: false },
      trend:      calcTrend(barnData.history),
      source:     recent?.source ?? 'pending',
    });
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexOut, null, 2) + '\n');
  console.log('\n=== index.json updated ===');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
