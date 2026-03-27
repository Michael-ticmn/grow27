// scripts/scrape-barns.js
// grow27 — auction barn price scraper (orchestrator)
// Runs via GitHub Actions daily at 7am CT.
// Reads data/barns-config.json, writes data/prices/<id>.json + data/prices/index.json.
//
// Architecture:
//   This file handles the common loop (fetch page, delegate parse, write output).
//   Barn-specific parsing lives in scripts/barns/<id>.js — each module exports
//   a parse({ id, browser, html, $ }) function returning the standard result shape.
//   If no barn-specific module exists, scripts/barns/_default.js is used.
//
// Deps: cheerio (HTML parsing), puppeteer (JS-rendered pages + image download),
//       tesseract.js (OCR), sharp (image processing).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs        = require('fs');
const path      = require('path');

// These deps are installed in GitHub Actions — lazy-require to allow
// barn parsers to import shared helpers without needing all deps locally.
let cheerio, puppeteer;
function ensureDeps() {
  if (!cheerio)   cheerio   = require('cheerio');
  if (!puppeteer) puppeteer = require('puppeteer');
}

const ROOT         = path.join(__dirname, '..');
const CONFIG_PATH  = path.join(ROOT, 'data', 'barns-config.json');
const PRICES_DIR   = path.join(ROOT, 'data', 'prices');
const INDEX_PATH   = path.join(PRICES_DIR, 'index.json');

const MAX_HISTORY = Infinity;  // no limit — monitor site speed as files grow

// ── Shared helpers (exported for barn parsers) ──────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function trimHistory(history) {
  // Sort newest-first, keep the last MAX_HISTORY entries by date
  return [...history]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_HISTORY);
}

// ── Price extraction from OCR text ──────────────────────────────────────────

// OCR often drops decimals: "224.00" → "22400", "239.00" → "23900"
// Upper bound 500 covers light feeder calves (400-500¢/lb common)
function normalizePrice(raw) {
  const v = parseFloat(raw);
  if (isNaN(v)) return null;
  if (raw.includes('.')) return (v >= 100 && v <= 500) ? v : null;
  if (v >= 10000 && v <= 50000) return v / 100;
  if (v >= 1000 && v <= 5000) return v / 10;
  if (v >= 100 && v <= 500) return v;
  return null;
}

const RANGE_RE  = /(\d{3,5}(?:\.\d{2})?)\s*[-–]\s*(\d{3,5}(?:\.\d{2})?)/;
const SPACE_RANGE_RE = /(\d{3,5}(?:\.\d{2})?)\s+(\d{3,5}(?:\.\d{2})?)/;
const SINGLE_RE = /(\d{3,5}(?:\.\d{2})?)/;

function extractLinePrice(line) {
  const range = line.match(RANGE_RE);
  if (range) {
    const a = normalizePrice(range[1]), b = normalizePrice(range[2]);
    if (a !== null && b !== null) return { low: parseFloat(a.toFixed(2)), high: parseFloat(b.toFixed(2)) };
    if (a !== null) return { low: parseFloat(a.toFixed(2)), high: parseFloat(a.toFixed(2)) };
    if (b !== null) return { low: parseFloat(b.toFixed(2)), high: parseFloat(b.toFixed(2)) };
  }
  const spaceRange = line.match(SPACE_RANGE_RE);
  if (spaceRange) {
    const a = normalizePrice(spaceRange[1]), b = normalizePrice(spaceRange[2]);
    if (a !== null && b !== null) return { low: parseFloat(a.toFixed(2)), high: parseFloat(b.toFixed(2)) };
    if (a !== null) return { low: parseFloat(a.toFixed(2)), high: parseFloat(a.toFixed(2)) };
    if (b !== null) return { low: parseFloat(b.toFixed(2)), high: parseFloat(b.toFixed(2)) };
  }
  const single = line.match(SINGLE_RE);
  if (single) {
    const v = normalizePrice(single[1]);
    if (v !== null) return { low: parseFloat(v.toFixed(2)), high: parseFloat(v.toFixed(2)) };
  }
  return null;
}

// Legacy helper: extract midpoint as a single number (used by rep sales parsing)
function extractLinePriceMid(line) {
  const p = extractLinePrice(line);
  if (!p) return null;
  if (p.low != null && p.high != null) return parseFloat(((p.low + p.high) / 2).toFixed(2));
  return p.high ?? p.low;
}

// ── Barn parser loader ──────────────────────────────────────────────────────

const BARNS_DIR = path.join(__dirname, 'barns');

function loadBarnParser(id) {
  // Try barn-specific parser first, fall back to _default
  const specific = path.join(BARNS_DIR, `${id}.js`);
  if (fs.existsSync(specific)) {
    console.log(`[${id}] using custom parser: barns/${id}.js`);
    return require(specific);
  }
  console.log(`[${id}] no custom parser found — using barns/_default.js`);
  return require(path.join(BARNS_DIR, '_default.js'));
}

// ── Fetch page via Puppeteer ────────────────────────────────────────────────

async function fetchPage(id, reportUrl) {
  ensureDeps();
  let browser;
  try {
    console.log(`[${id}] launching Puppeteer for: ${reportUrl}`);
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(reportUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));
    const html = await page.content();
    console.log(`[${id}] fetch OK · ${html.length} bytes`);
    if (html.length < 500) throw new Error('response too short — likely blocked or empty');
    return { browser, html };
  } catch (err) {
    if (browser) await browser.close();
    throw err;
  }
}

// ── Load / save helpers ─────────────────────────────────────────────────────

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
    console.log(`[${data.id}] wrote ${p} · history length: ${data.history.length}`);
  } catch (e) {
    console.error(`[${data.id}] WRITE FAILED: ${p} — ${e.message}`);
    throw e;
  }
}

// ── Null entry builder ──────────────────────────────────────────────────────

function nullEntry(dateStr, source = 'pending') {
  return {
    date: dateStr,
    slaughter: { beef: null, crossbred: null, holstein: null },
    feeder:    { beef: null, crossbred: null, holstein: null, liteTest: false },
    source,
  };
}

// Ensure a price value is in {low, high} format for index.json
function toRange(v) {
  if (v == null) return null;
  if (typeof v === 'object' && ('low' in v || 'high' in v)) return v;
  if (typeof v === 'number') return { low: v, high: v };
  return null;
}

// ── Trend helper ────────────────────────────────────────────────────────────

function priceMid(v) {
  if (v == null) return null;
  if (typeof v === 'object' && v.high != null) return (v.low != null ? (v.low + v.high) / 2 : v.high);
  return typeof v === 'number' ? v : null;
}

function calcTrend(history) {
  const good = [...history]
    .filter(e => (e.source === 'scraped' || e.source === 'calculated') && e.slaughter?.beef != null)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (good.length < 2) return null;
  const cur = priceMid(good[0].slaughter.beef);
  const prev = priceMid(good[1].slaughter.beef);
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (diff >  0.5) return 'up';
  if (diff < -0.5) return 'down';
  return 'flat';
}

// ── Main ────────────────────────────────────────────────────────────────────

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

    // Load existing file
    const barnData = loadBarnFile(id, name, location);

    // Build list of reports to scrape:
    //   - config.reports[] (new multi-report format)
    //   - config.reportUrl (legacy single-report format)
    //   - neither → pending
    const reports = config.reports
      || (config.reportUrl ? [{ day: null, url: config.reportUrl }] : []);

    if (config.hasTypeBreakdown && reports.length > 0) {
      for (const report of reports) {
        const tag = report.day || 'report';
        console.log(`\n── [${id}] ${tag}: ${report.url} ──`);

        let browser, html;
        try {
          ({ browser, html } = await fetchPage(id, report.url));
        } catch (fetchErr) {
          console.error(`[${id}:${tag}] FETCH FAILED: ${fetchErr.message}`);
          const entry = nullEntry(todayStr, 'fetch_failed');
          entry.saleDay = report.day;
          entry.error = fetchErr.message;

          // Dedup by date + saleDay, then append
          barnData.history = trimHistory(barnData.history)
            .filter(e => !(e.date === todayStr && e.saleDay === report.day));
          barnData.history.push(entry);
          continue;
        }

        try {
          ensureDeps();
          const $ = cheerio.load(html);
          const parser = loadBarnParser(id);
          const result = await parser.parse({ id, browser, html, $ });

          const entry = {
            date:         result.reportDate || todayStr,
            slaughter:    result.slaughter ?? { beef: null, crossbred: null, holstein: null },
            feeder:       result.feeder    ?? { beef: null, crossbred: null, holstein: null, liteTest: false },
            feederWeights: result.feederWeights ?? [],
            saleDay:      result.saleDay || report.day || null,
            liteTestNote: result.liteTestNote ?? null,
            repSales:     result.repSales ?? null,
            hogs:         result.hogs ?? null,
            source:       result.source,
          };
          if (result.sheetGid) entry.sheetGid = result.sheetGid;
          if (result.error) entry.error = result.error;
          if (result.source === 'scraped') {
            const successDate = result.reportDate || todayStr;
            if (!barnData.lastSuccess || successDate > barnData.lastSuccess) barnData.lastSuccess = successDate;
          }

          console.log(`[${id}:${tag}] entry: ${JSON.stringify(entry)}`);

          // Batch entries from parsers that process multiple reports (e.g. PDFs)
          if (result._batchEntries && result._batchEntries.length) {
            console.log(`[${id}:${tag}] merging ${result._batchEntries.length} batch entries`);
            for (const be of result._batchEntries) {
              const batchEntry = {
                date:         be.reportDate || todayStr,
                slaughter:    be.slaughter ?? { beef: null, crossbred: null, holstein: null },
                feeder:       be.feeder    ?? { beef: null, crossbred: null, holstein: null, liteTest: false },
                feederWeights: be.feederWeights ?? [],
                saleDay:      be.saleDay || report.day || null,
                liteTestNote: be.liteTestNote ?? null,
                repSales:     be.repSales ?? null,
                hogs:         be.hogs ?? null,
                source:       be.source,
              };
              if (be.sheetGid) batchEntry.sheetGid = be.sheetGid;
              if (be.source === 'scraped') {
                const sd = be.reportDate || todayStr;
                if (!barnData.lastSuccess || sd > barnData.lastSuccess) barnData.lastSuccess = sd;
              }
              barnData.history = barnData.history
                .filter(e => !(e.date === batchEntry.date && e.saleDay === batchEntry.saleDay));
              barnData.history.push(batchEntry);
            }
          }

          // Dedup by date + saleDay, then append
          barnData.history = trimHistory(barnData.history)
            .filter(e => !(e.date === entry.date && e.saleDay === entry.saleDay));
          barnData.history.push(entry);
        } finally {
          if (browser) await browser.close();
        }
      }
    } else {
      // No type breakdown / no report URL — write pending entry
      const entry = nullEntry(todayStr, 'pending');
      console.log(`[${id}] no reportUrl or no type breakdown — writing pending entry`);

      barnData.history = trimHistory(barnData.history)
        .filter(e => !(e.date === todayStr && e.saleDay == null));
      barnData.history.push(entry);
    }

    barnData.lastUpdated = todayStr;
    saveBarnFile(barnData);

    indexOut.push(buildIndexRow(barnData, id, name, location));
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexOut, null, 2) + '\n');
  console.log('\n=== index.json updated ===');
}

// Merge rep sales from two entries — picks the best data for each sub-field.
// Slaughter entry typically has finishWeightAvgs, bullsWeightAvgs, cowsWeightAvgs.
// Feeder entry typically has feederWeightAvgs. Head counts are summed.
function mergeRepSales(slaughterRep, feederRep) {
  if (!slaughterRep && !feederRep) return null;
  if (!slaughterRep) return feederRep;
  if (!feederRep) return slaughterRep;

  // If both entries are the same object, don't double-count
  if (slaughterRep === feederRep) return slaughterRep;

  // Combine arrays from both sale days so no data is dropped
  const concat = (a, b) => [...(a || []), ...(b || [])];

  return {
    finishWeightAvgs: concat(slaughterRep.finishWeightAvgs, feederRep.finishWeightAvgs),
    feederWeightAvgs: concat(slaughterRep.feederWeightAvgs, feederRep.feederWeightAvgs),
    bullsWeightAvgs:  concat(slaughterRep.bullsWeightAvgs, feederRep.bullsWeightAvgs),
    cowsWeightAvgs:   concat(slaughterRep.cowsWeightAvgs, feederRep.cowsWeightAvgs),
    headCount: {
      finished: (slaughterRep.headCount?.finished || 0) + (feederRep.headCount?.finished || 0),
      feeder:   (slaughterRep.headCount?.feeder || 0) + (feederRep.headCount?.feeder || 0),
      bulls:    (slaughterRep.headCount?.bulls || 0) + (feederRep.headCount?.bulls || 0),
      cows:     (slaughterRep.headCount?.cows || 0) + (feederRep.headCount?.cows || 0),
    },
  };
}

function buildIndexRow(barnData, id, name, location) {
  const scraped = [...barnData.history]
    .filter(e => e.source === 'scraped' || e.source === 'calculated')
    .sort((a, b) => b.date.localeCompare(a.date));

  // Pick best entry for each category independently (most recent with data)
  const slaughterEntry = scraped.find(e => e.slaughter && Object.values(e.slaughter).some(v => v != null));
  // Feeder: prefer the entry with the most feeder weight brackets (the real "feeder sale"),
  // not just the most recent entry that happens to have a few feeders
  const feederCandidates = scraped.filter(e =>
    (e.feeder && Object.values(e.feeder).some(v => v != null && v !== false))
    || (e.feederWeights && e.feederWeights.length > 0)
  );
  const feederEntry = feederCandidates.sort((a, b) =>
    (b.feederWeights?.length || 0) - (a.feederWeights?.length || 0)
    || b.date.localeCompare(a.date)
  )[0] || null;
  const recent = slaughterEntry || feederEntry || scraped[0];

  // Collect the latest scraped entry per sale day (for barns with multiple sale days)
  const byDay = {};
  for (const e of scraped) {
    const day = e.saleDay || '_default';
    if (!byDay[day]) byDay[day] = e;
  }
  const saleDays = Object.keys(byDay).filter(k => k !== '_default').length > 0
    ? Object.entries(byDay)
        .filter(([k]) => k !== '_default')
        .map(([day, e]) => ({
          day,
          date:         e.date,
          slaughter:    e.slaughter,
          feeder:       e.feeder,
          feederWeights: e.feederWeights ?? [],
          repSales:     e.repSales ?? null,
          hogs:         e.hogs ?? null,
          liteTestNote: e.liteTestNote ?? null,
        }))
    : null;

  return {
    id,
    name,
    location,
    lastSuccess:  barnData.lastSuccess,
    // Slaughter: from best slaughter entry (normalize to {low, high})
    slaughter: slaughterEntry?.slaughter
      ? { beef: toRange(slaughterEntry.slaughter.beef), crossbred: toRange(slaughterEntry.slaughter.crossbred), holstein: toRange(slaughterEntry.slaughter.holstein) }
      : { beef: null, crossbred: null, holstein: null },
    slaughterSaleDay: slaughterEntry?.saleDay ?? null,
    slaughterDate:    slaughterEntry?.date ?? null,
    // Feeder: from best feeder entry (may be a different sale day)
    feeder: feederEntry?.feeder
      ? { beef: toRange(feederEntry.feeder.beef), crossbred: toRange(feederEntry.feeder.crossbred), holstein: toRange(feederEntry.feeder.holstein), liteTest: feederEntry.feeder.liteTest ?? false }
      : { beef: null, crossbred: null, holstein: null, liteTest: false },
    feederWeights:    feederEntry?.feederWeights ?? [],
    feederSaleDay:    feederEntry?.saleDay ?? null,
    feederDate:       feederEntry?.date ?? null,
    // Rep sales: merge from both entries — slaughter has finish/bulls/cows, feeder has feeder data
    repSales:     mergeRepSales(slaughterEntry?.repSales, feederEntry?.repSales),
    saleDay:      recent?.saleDay ?? null,
    liteTestNote: feederEntry?.liteTestNote ?? slaughterEntry?.liteTestNote ?? null,
    saleDays,
    trend:        calcTrend(barnData.history),
    source:       recent?.source ?? 'pending',
  };
}

// ── Export shared helpers for barn parsers ───────────────────────────────────

module.exports = {
  normalizePrice,
  extractLinePrice,
  extractLinePriceMid,
  RANGE_RE,
  SPACE_RANGE_RE,
  SINGLE_RE,
};

// ── Run if executed directly ────────────────────────────────────────────────

if (require.main === module) {
  run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
