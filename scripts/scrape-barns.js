// scripts/scrape-barns.js
// grow27 — auction barn price scraper
// Runs via GitHub Actions daily at 7am CT.
// Reads data/barns-config.json, writes data/prices/<id>.json + data/prices/index.json.
// Node.js 20+ (built-in fetch). Only external dep: cheerio.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs      = require('fs');
const path    = require('path');
const cheerio = require('cheerio');

const ROOT         = path.join(__dirname, '..');
const CONFIG_PATH  = path.join(ROOT, 'data', 'barns-config.json');
const PRICES_DIR   = path.join(ROOT, 'data', 'prices');
const INDEX_PATH   = path.join(PRICES_DIR, 'index.json');

const MAX_HISTORY  = 14;   // entries to keep
const MAX_AGE_DAYS = 14;   // days before trimming

// ── Discount schedule ────────────────────────────────────────────────────────
const SLAUGHTER_DISC = { beef: 0, crossbred: 9.50, holstein: 30.00 }; // ¢/cwt off beef
const FEEDER_FACTOR  = 0.40; // feeder discount = 40% of slaughter discount

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

/** Normalise cell text: collapse whitespace, lowercase. */
function norm(text) {
  return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Extract midpoint from a price string.
 * Handles: "224.00-239.00", "224.00–239.00", "224.00 to 239.00", "231.50"
 */
function midpoint(text) {
  const range = text.match(/(\d{2,3}(?:\.\d+)?)\s*(?:[-–]|to)\s*(\d{2,3}(?:\.\d+)?)/);
  if (range) return (parseFloat(range[1]) + parseFloat(range[2])) / 2;
  const single = text.match(/(\d{2,3}(?:\.\d+)?)/);
  if (single) return parseFloat(single[1]);
  return null;
}

/** Pull the first plausible price value from text in a price range. */
function extractPrice(text, minVal = 150, maxVal = 400) {
  const v = midpoint(text);
  return (v !== null && v >= minVal && v <= maxVal) ? parseFloat(v.toFixed(2)) : null;
}

// ── HTML scraper ─────────────────────────────────────────────────────────────

async function scrapeBarns(config) {
  const { id, reportUrl, parseRules } = config;

  let html;
  try {
    const res = await fetch(reportUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; grow27-bot/1.0; +https://michael-ticmn.github.io/grow27/)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
    if (html.length < 500) throw new Error('response too short — likely blocked');
  } catch (fetchErr) {
    console.warn(`[${id}] fetch failed: ${fetchErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: fetchErr.message };
  }

  try {
    const $ = cheerio.load(html);
    const slaughter = { beef: null, crossbred: null, holstein: null };
    const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };

    // Flatten all td/th text with their position index
    const cells = [];
    $('td, th').each((i, el) => {
      cells.push({ i, text: $(el).text().replace(/\s+/g, ' ').trim() });
    });

    /**
     * Scan forward from headerIdx looking for the first cell whose text
     * contains a plausible price value.
     */
    function priceAfter(headerIdx, minVal = 150, maxVal = 400) {
      for (let j = headerIdx + 1; j < Math.min(headerIdx + 12, cells.length); j++) {
        const p = extractPrice(cells[j].text, minVal, maxVal);
        if (p !== null) return p;
      }
      return null;
    }

    // ── Slaughter — match on parseRules.slaughter labels ──────────────────
    for (const [type, label] of Object.entries(parseRules.slaughter)) {
      const target = norm(label);
      const headerIdx = cells.findIndex(c => norm(c.text).includes(target));
      if (headerIdx === -1) {
        console.warn(`[${id}] slaughter header not found: "${label}"`);
        continue;
      }
      const price = priceAfter(headerIdx);
      if (price !== null) {
        slaughter[type] = price;
        console.log(`[${id}] slaughter.${type} = ${price} (header: "${cells[headerIdx].text}")`);
      } else {
        console.warn(`[${id}] no price found after slaughter header: "${cells[headerIdx].text}"`);
      }
    }

    // ── Feeder — fuzzy prefix match; strip "lite test" suffix before comparing ─
    for (const [type, labelPrefix] of Object.entries(parseRules.feeder)) {
      const target = norm(labelPrefix);
      const headerIdx = cells.findIndex(c => {
        // Strip optional "- lite test" / "– lite test" suffix then check prefix
        const base = norm(c.text).replace(/\s*[-–]\s*lite\s*test.*$/, '').trim();
        return base.startsWith(target);
      });
      if (headerIdx === -1) {
        console.warn(`[${id}] feeder header not found for prefix: "${labelPrefix}"`);
        continue;
      }
      const price = priceAfter(headerIdx, 100, 500);
      if (price !== null) {
        if (type === 'beef')     feeder.beef    = price;
        if (type === 'holstein') feeder.holstein = price;
        // Flag lite-test cattle if the word "lite" appears anywhere in the matched header
        if (norm(cells[headerIdx].text).includes('lite')) feeder.liteTest = true;
        console.log(`[${id}] feeder.${type} = ${price} (header: "${cells[headerIdx].text}")`);
      } else {
        console.warn(`[${id}] no price found after feeder header: "${cells[headerIdx].text}"`);
      }
    }

    // Derive crossbred feeder from beef feeder if we got it
    if (feeder.beef !== null) {
      feeder.crossbred = parseFloat(
        (feeder.beef - SLAUGHTER_DISC.crossbred * FEEDER_FACTOR).toFixed(2)
      );
    }

    const hasSlaughter = Object.values(slaughter).some(v => v !== null);
    const hasFeeder    = feeder.beef !== null || feeder.holstein !== null;
    if (!hasSlaughter && !hasFeeder) {
      throw new Error('cheerio found headers but extracted zero prices — page structure may have changed');
    }

    return { slaughter, feeder, source: 'scraped', error: null };

  } catch (parseErr) {
    console.warn(`[${id}] parse error: ${parseErr.message}`);
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
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { id, name, location, lastUpdated: today(), lastSuccess: null, history: [] };
  }
}

function saveBarnFile(data) {
  const p = path.join(PRICES_DIR, `${data.id}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
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
  console.log(`\n=== grow27 barn scraper · ${todayStr} ===\n`);

  const barnsConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const indexOut = [];

  for (const config of barnsConfig) {
    const { id, name, location } = config;
    console.log(`── ${id} ──`);

    const barnData = loadBarnFile(id, name, location);

    let entry;
    if (config.hasTypeBreakdown && config.reportUrl) {
      // Attempt live scrape
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
      // No report URL — write a pending null entry; USDA pipeline will fill slaughter baseline
      entry = nullEntry(todayStr, 'pending');
      console.log(`[${id}] no reportUrl — pending entry written`);
    }

    // Trim then append — never duplicate same-date entries
    barnData.history = trimHistory(barnData.history).filter(e => e.date !== todayStr);
    barnData.history.push(entry);
    barnData.lastUpdated = todayStr;

    saveBarnFile(barnData);
    console.log(`[${id}] saved · source=${entry.source}\n`);

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
  console.log('=== index.json updated ===');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
