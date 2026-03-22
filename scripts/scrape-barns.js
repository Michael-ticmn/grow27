// scripts/scrape-barns.js
// grow27 — auction barn price scraper
// Runs via GitHub Actions daily at 7am CT.
// Reads data/barns-config.json, writes data/prices/<id>.json + data/prices/index.json.
// Deps: cheerio (HTML parsing), puppeteer (JS-rendered pages + image download),
//       tesseract.js (OCR).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs        = require('fs');
const path      = require('path');
const cheerio   = require('cheerio');
const puppeteer = require('puppeteer');
const Tesseract = require('tesseract.js');

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

// ── Price extraction from OCR text ──────────────────────────────────────────

// OCR often drops decimals: "224.00" → "22400", "239.00" → "23900"
// Normalize a raw number string into a proper price (cents per cwt)
function normalizePrice(raw) {
  const v = parseFloat(raw);
  if (isNaN(v)) return null;
  // Already has a decimal → use as-is if in valid range
  if (raw.includes('.')) return (v >= 100 && v <= 400) ? v : null;
  // 5-digit integer (e.g. 22400 → 224.00, 40500 → 405.00)
  if (v >= 10000 && v <= 50000) return v / 100;
  // 3-digit integer in valid range (e.g. 235 → 235.00)
  if (v >= 100 && v <= 400) return v;
  return null;
}

// Match price ranges: "224.00 - 239.00", "22400-23900", "22400 23900"
// Also handles mixed: "22000 - 235.00"
const RANGE_RE  = /(\d{3,5}(?:\.\d{2})?)\s*[-–]\s*(\d{3,5}(?:\.\d{2})?)/;
// Two numbers separated by spaces (OCR drops the dash): "22400 23900"
const SPACE_RANGE_RE = /(\d{3,5}(?:\.\d{2})?)\s+(\d{3,5}(?:\.\d{2})?)/;
const SINGLE_RE = /(\d{3,5}(?:\.\d{2})?)/;

function extractLinePrice(line) {
  // Try range with dash/en-dash first
  const range = line.match(RANGE_RE);
  if (range) {
    const a = normalizePrice(range[1]), b = normalizePrice(range[2]);
    if (a !== null && b !== null) return parseFloat(((a + b) / 2).toFixed(2));
    if (a !== null) return parseFloat(a.toFixed(2));
    if (b !== null) return parseFloat(b.toFixed(2));
  }
  // Try two numbers separated by space (OCR artifact)
  const spaceRange = line.match(SPACE_RANGE_RE);
  if (spaceRange) {
    const a = normalizePrice(spaceRange[1]), b = normalizePrice(spaceRange[2]);
    if (a !== null && b !== null) return parseFloat(((a + b) / 2).toFixed(2));
    if (a !== null) return parseFloat(a.toFixed(2));
    if (b !== null) return parseFloat(b.toFixed(2));
  }
  // Single price
  const single = line.match(SINGLE_RE);
  if (single) {
    const v = normalizePrice(single[1]);
    if (v !== null) return parseFloat(v.toFixed(2));
  }
  return null;
}

// ── OCR-based scraper (for barns that publish report as PNG image) ───────────

async function scrapeBarns(config) {
  const { id, reportUrl } = config;

  let browser;
  try {
    // ── 1. Fetch rendered HTML via Puppeteer ──────────────────────────────
    let html;
    try {
      console.log(`[${id}] launching Puppeteer for: ${reportUrl}`);
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.goto(reportUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
      html = await page.content();
      console.log(`[${id}] fetch OK · ${html.length} bytes`);
      if (html.length < 500) throw new Error('response too short — likely blocked or empty');
    } catch (fetchErr) {
      console.error(`[${id}] FETCH FAILED: ${fetchErr.message}`);
      return { slaughter: null, feeder: null, source: 'fetch_failed', error: fetchErr.message };
    }

    // ── 2. Extract og:image URL containing "screenshot" ──────────────────
    let imageUrl;
    try {
      const $ = cheerio.load(html);
      const ogImages = [];
      $('meta[property="og:image"]').each((_, el) => {
        const url = $(el).attr('content');
        if (url) ogImages.push(url);
      });
      console.log(`[${id}] og:image URLs found: ${ogImages.length}`);
      ogImages.forEach((u, i) => console.log(`[${id}]   [${i}] ${u}`));

      // Prefer URL containing "screenshot" in the filename
      imageUrl = ogImages.find(u => /screenshot/i.test(u))
              || ogImages.find(u => /report|market|cattle|price/i.test(u))
              || ogImages[0];

      if (!imageUrl) throw new Error('no og:image meta tag found');
      console.log(`[${id}] selected image URL: ${imageUrl}`);
    } catch (imgErr) {
      console.error(`[${id}] IMAGE EXTRACT FAILED: ${imgErr.message}`);
      return { slaughter: null, feeder: null, source: 'fetch_failed', error: imgErr.message };
    }

    // ── 3. Download PNG via Puppeteer (avoids 403 from bare fetch) ────────
    let imgBuffer;
    try {
      const page = await browser.newPage();
      const imgResponse = await page.goto(imageUrl, {
        waitUntil: 'networkidle2',
        timeout: 15000,
      });
      if (!imgResponse.ok()) throw new Error(`HTTP ${imgResponse.status()}`);
      imgBuffer = await imgResponse.buffer();
      console.log(`[${id}] image downloaded via Puppeteer · ${imgBuffer.length} bytes`);
    } catch (dlErr) {
      console.error(`[${id}] IMAGE DOWNLOAD FAILED: ${dlErr.message}`);
      return { slaughter: null, feeder: null, source: 'fetch_failed', error: dlErr.message };
    }

  // ── 4. Run Tesseract OCR ──────────────────────────────────────────────
  let ocrText;
  try {
    console.log(`[${id}] running Tesseract OCR...`);
    const { data } = await Tesseract.recognize(imgBuffer, 'eng');
    ocrText = data.text;
    console.log(`[${id}] OCR complete · ${ocrText.length} chars`);
    console.log(`[${id}] OCR text preview:\n${ocrText.slice(0, 1000)}\n`);
  } catch (ocrErr) {
    console.error(`[${id}] OCR FAILED: ${ocrErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: ocrErr.message };
  }

  // ── 5. Parse prices from OCR text via regex ───────────────────────────
  try {
    const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
    const slaughter = { beef: null, crossbred: null, holstein: null };
    const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };

    // Track whether we're in the feeder section (for liteTest detection)
    let inFeederSection = false;
    // Track feeder sub-headers so we can grab prices from following lines
    let feederBeefHeader = -1;
    let feederHolsteinHeader = -1;

    // Helper: extract the best price from a line, filtering out weight ranges
    // Weight ranges look like "350 - 600%" or "800 - 1000%" — skip those
    function extractPriceSkipWeights(line) {
      // Remove weight-range patterns before price extraction
      const cleaned = line
        .replace(/\d{2,4}\s*[-–]\s*\d{2,4}\s*[%#]/g, '')   // "350 - 600%"
        .replace(/under\s+\d+[#%]/gi, '')                    // "under 400#"
        .replace(/upto\s*[-–]\s*/gi, '');                     // "upto -" prefix
      return extractLinePrice(cleaned);
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // ── Slaughter headers ──────────────────────────────────────────────
      if (/finished\s+beef\s+steers/i.test(line)) {
        const price = extractPriceSkipWeights(line);
        if (price !== null) {
          slaughter.beef = price;
          console.log(`[${id}] slaughter.beef = ${price} ✓`);
        }
      }
      else if (/finished\s+dairy[\s-]*x/i.test(line) || /dairy[\s-]*x\s+steers/i.test(line)) {
        const price = extractPriceSkipWeights(line);
        if (price !== null) {
          slaughter.crossbred = price;
          console.log(`[${id}] slaughter.crossbred = ${price} ✓`);
        }
      }
      else if (/finished\s+dairy\s+steers/i.test(line)) {
        const price = extractPriceSkipWeights(line);
        if (price !== null) {
          slaughter.holstein = price;
          console.log(`[${id}] slaughter.holstein = ${price} ✓`);
        }
      }

      // ── Feeder section detection ───────────────────────────────────────
      // "Feeder Cattle" marks start of feeder section
      if (/feeder\s+cattle/i.test(line)) {
        inFeederSection = true;
        console.log(`[${id}] entered feeder section at line ${i}`);
      }

      // In feeder section: "Beef Steers" (not "Finished") → feeder.beef
      if (inFeederSection && /beef\s+steers/i.test(line) && !/finished/i.test(line)) {
        feederBeefHeader = i;
        const price = extractPriceSkipWeights(line);
        if (price !== null) {
          feeder.beef = price;
          console.log(`[${id}] feeder.beef = ${price} ✓ (same line)`);
        }
      }

      // In feeder section: "Dairy Steers" (not "Finished") → feeder.holstein
      if (inFeederSection && /dairy\s+steers/i.test(line) && !/finished/i.test(line)) {
        feederHolsteinHeader = i;
        const price = extractPriceSkipWeights(line);
        if (price !== null) {
          feeder.holstein = price;
          console.log(`[${id}] feeder.holstein = ${price} ✓ (same line)`);
        }
      }

      // Look-ahead: if we're on a line right after a feeder header,
      // try to grab the highest "upto" price as the top-end estimate
      if (feeder.beef === null && feederBeefHeader >= 0 && i > feederBeefHeader && i <= feederBeefHeader + 6) {
        if (/upto/i.test(line)) {
          const price = extractPriceSkipWeights(line);
          if (price !== null) {
            feeder.beef = price;
            console.log(`[${id}] feeder.beef = ${price} ✓ (from upto line ${i})`);
          }
        }
      }
      if (feeder.holstein === null && feederHolsteinHeader >= 0 && i > feederHolsteinHeader && i <= feederHolsteinHeader + 6) {
        if (/upto/i.test(line)) {
          const price = extractPriceSkipWeights(line);
          if (price !== null) {
            feeder.holstein = price;
            console.log(`[${id}] feeder.holstein = ${price} ✓ (from upto line ${i})`);
          }
        }
      }

      // ── Lite test detection ────────────────────────────────────────────
      if (inFeederSection && /lite/i.test(lower)) {
        feeder.liteTest = true;
        console.log(`[${id}] feeder.liteTest = true ✓`);
      }
    }

    // Derive crossbred feeder from beef feeder
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
      throw new Error('OCR returned no usable prices — text may be unreadable');
    }

    return { slaughter, feeder, source: 'scraped', error: null };

  } catch (parseErr) {
    console.error(`[${id}] PARSE ERROR: ${parseErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: parseErr.message };
  }

  } finally {
    if (browser) await browser.close();
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
      // No type breakdown / no report URL — write pending entry
      entry = nullEntry(todayStr, 'pending');
      console.log(`[${id}] no reportUrl or no type breakdown — writing pending entry`);
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
