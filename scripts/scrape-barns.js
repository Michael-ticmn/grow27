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

    // ── Parse HTML once for reuse ──────────────────────────────────────────
    const $ = cheerio.load(html);

    // ── 2. Extract og:image URL containing "screenshot" ──────────────────
    let imageUrl;
    try {
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

      // Identify additional images (market2, market3) for representative sales
      var repImageUrls = ogImages.filter(u => u !== imageUrl);
      console.log(`[${id}] additional images for rep sales: ${repImageUrls.length}`);
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

  // ── 4. Run Tesseract OCR on main image ────────────────────────────────
  let ocrText;
  try {
    console.log(`[${id}] running Tesseract OCR on main image...`);
    const { data } = await Tesseract.recognize(imgBuffer, 'eng');
    ocrText = data.text;
    console.log(`[${id}] OCR complete · ${ocrText.length} chars`);
    console.log(`[${id}] OCR text preview:\n${ocrText.slice(0, 1000)}\n`);
  } catch (ocrErr) {
    console.error(`[${id}] OCR FAILED: ${ocrErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: ocrErr.message };
  }

  // ── 4b. Download and OCR additional images (rep sales) ────────────────
  const repOcrTexts = [];
  for (const repUrl of repImageUrls) {
    try {
      console.log(`[${id}] downloading rep sales image: ${repUrl}`);
      const page = await browser.newPage();
      const resp = await page.goto(repUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      if (!resp.ok()) { console.warn(`[${id}] rep image HTTP ${resp.status()}`); continue; }
      const buf = await resp.buffer();
      console.log(`[${id}] rep image downloaded · ${buf.length} bytes`);
      const { data } = await Tesseract.recognize(buf, 'eng');
      repOcrTexts.push(data.text);
      console.log(`[${id}] rep OCR complete · ${data.text.length} chars`);
      console.log(`[${id}] rep OCR preview:\n${data.text.slice(0, 500)}\n`);
    } catch (repErr) {
      console.warn(`[${id}] rep image OCR failed (non-fatal): ${repErr.message}`);
    }
  }

  // ── 5. Parse prices from OCR text via regex ───────────────────────────
  try {
    const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
    const slaughter = { beef: null, crossbred: null, holstein: null };
    const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };
    const feederWeights = [];  // { range, price, types } per weight class
    let reportDate = null;  // extracted from "Market Report - MM/DD/YYYY"
    let saleDay = null;     // extracted from "Monday - Cattle" or similar
    let liteTestNote = null; // extracted from "lite test see Thur 3/5/26 Report"

    // Track whether we're in the feeder section (for liteTest detection)
    let inFeederSection = false;
    // Track feeder sub-headers so we can grab prices from following lines
    let feederBeefHeader = -1;
    let feederHolsteinHeader = -1;
    // Current feeder sub-section type(s) for weight collection
    let currentFeederTypes = null;

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

    // Helper: extract the price specifically after "upto" keyword
    // For two-column OCR lines like "Mixed Grading 21500-22300 owt 350 - 600% upto - 40500 cwt"
    // we only want the number right after "upto", not the slaughter prices from the left column
    function extractUptoPrice(line) {
      const m = line.match(/upto\s*[-–]?\s*(\d{3,5}(?:\.\d{2})?)/i);
      if (m) {
        const v = normalizePrice(m[1]);
        if (v !== null) return parseFloat(v.toFixed(2));
      }
      return null;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // ── Report date extraction ─────────────────────────────────────────
      if (!reportDate && /market\s*report/i.test(line)) {
        const dm = line.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (dm) {
          const mm = dm[1].padStart(2, '0');
          const dd = dm[2].padStart(2, '0');
          const yyyy = dm[3].length === 2 ? '20' + dm[3] : dm[3];
          reportDate = `${yyyy}-${mm}-${dd}`;
          console.log(`[${id}] report date: ${reportDate}`);
        }
      }

      // ── Sale day extraction (e.g. "Monday - Cattle") ────────────────────
      if (!saleDay && /^(monday|tuesday|wednesday|thursday|friday|saturday)\s*[-–]\s*cattle/i.test(line)) {
        saleDay = line.match(/^(monday|tuesday|wednesday|thursday|friday|saturday)/i)[1];
        saleDay = saleDay.charAt(0).toUpperCase() + saleDay.slice(1).toLowerCase();
        console.log(`[${id}] sale day: ${saleDay}`);
      }

      // ── Lite test note extraction ────────────────────────────────────────
      if (!liteTestNote && /lite\s*test\s*see/i.test(line)) {
        const m = line.match(/lite\s*test\s*see\s+(.*)/i);
        if (m) {
          liteTestNote = 'lite test see ' + m[1].trim();
          console.log(`[${id}] lite test note: ${liteTestNote}`);
        }
      }

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

      // In feeder section: "Beef Steers & Bulls" is feeder-specific
      // (OCR may merge columns: "Finished Beef Steers 22400 23900 owt Beef Steers & Bulls")
      if (inFeederSection && /beef\s+steers\s*[&]\s*bulls/i.test(line)) {
        feederBeefHeader = i;
        currentFeederTypes = ['beef', 'crossbred'];
        console.log(`[${id}] feeder beef header at line ${i}: "${line}"`);
      }
      // "Beef Heifers" sub-section (also beef/crossbred types)
      else if (inFeederSection && /beef\s+heifers/i.test(line) && !/finished/i.test(line)) {
        currentFeederTypes = ['beef', 'crossbred'];
        console.log(`[${id}] feeder beef heifers header at line ${i}`);
      }
      // Fallback: "Beef Steers" without "Finished" on its own line
      else if (inFeederSection && /beef\s+steers/i.test(line) && !/finished/i.test(line)) {
        feederBeefHeader = i;
        currentFeederTypes = ['beef', 'crossbred'];
        const price = extractPriceSkipWeights(line);
        if (price !== null) {
          feeder.beef = price;
          console.log(`[${id}] feeder.beef = ${price} ✓ (same line)`);
        }
      }

      // In feeder section: "Dairy Steers" (not "Finished") → feeder.holstein
      if (inFeederSection && /dairy\s+steers/i.test(line) && !/finished/i.test(line)) {
        feederHolsteinHeader = i;
        currentFeederTypes = ['holstein'];
        const price = extractPriceSkipWeights(line);
        if (price !== null) {
          feeder.holstein = price;
          console.log(`[${id}] feeder.holstein = ${price} ✓ (same line)`);
        }
      }

      // ── Collect feeder weight ranges with upto prices ──────────────────
      // Match lines like "350 - 600% upto - 40500 cwt" or "600 - 800% upto - 33500 cw"
      if (inFeederSection && currentFeederTypes && /upto/i.test(line)) {
        // Extract weight range: "350 - 600%" or "800 - 1000%"
        const wm = line.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})\s*[%#]/);
        const price = extractUptoPrice(line);
        if (wm && price !== null) {
          const range = wm[1] + '–' + wm[2] + '#';
          feederWeights.push({ range, price, types: [...currentFeederTypes] });
          console.log(`[${id}] feederWeight: ${range} → ${price} [${currentFeederTypes}]`);
        }

        // Also set the top-end price for the first weight range per type
        if (price !== null) {
          if (feeder.beef === null && currentFeederTypes.includes('beef')) {
            feeder.beef = price;
            console.log(`[${id}] feeder.beef = ${price} ✓ (from upto line ${i})`);
          }
          if (feeder.holstein === null && currentFeederTypes.includes('holstein')) {
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

    // ── 6. Parse Representative Sales from OCR text (images 2 & 3) ─────────
    // The rep sales tables are PNG images, not HTML — parse from repOcrTexts[]
    // OCR reads two side-by-side columns left-to-right, producing merged lines:
    //   "ALBERT LEA, MN 1 BIKSTR 1105 23900 C_ GOODHUE, MN 1 HoLcow 1425 19000"
    // Strategy: detect dual-column mode when two section headers appear back-to-
    // back, then extract multiple sale entries per line — first match goes to
    // left-column category, second match to right-column category.
    const repSales = { finished: [], feeder: [], bulls: [], cows: [] };
    try {
      const allRepText = repOcrTexts.join('\n');
      if (allRepText.length > 0) {
        console.log(`[${id}] parsing rep sales from ${repOcrTexts.length} OCR images · ${allRepText.length} chars`);

        const rawLines = allRepText.split('\n').map(l => l.trim()).filter(Boolean);

        // Pre-split: break merged lines on "Representative Sales" boundaries
        const fragments = [];
        for (const line of rawLines) {
          const parts = line.split(/(?=Representative\s+Sales)/i);
          for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed) fragments.push(trimmed);
          }
        }
        console.log(`[${id}] rep OCR fragments: ${fragments.length} (from ${rawLines.length} raw lines)`);

        // Section header regex
        const SECTION_RE = /^Representative\s+Sales[:\s]+(.+)/i;

        // Sale row regex (loose — allows OCR case errors like BiKsTR)
        const SALE_ROW_RE = /([A-Za-z][A-Za-z\s.]+,\s*[A-Za-z]{2,3})\s+(\d{1,3})\s+([A-Za-z][A-Za-z\s\/]{2,20}?)\s+(\d{3,4})\s+(\d{3,6}(?:\.\d{2})?)/g;

        // Cattle breed/sex filter — prevents hog rows from leaking in
        const CATTLE_DESC_RE = /STR|HFR|COW|BULL|BUL|CALF|CLF/i;

        // Category mapper
        function mapCategory(secText) {
          if (/finish/i.test(secText))              return 'finished';
          if (/feeder\s*cattle/i.test(secText))     return 'feeder';
          if (/calve/i.test(secText))               return 'feeder';
          if (/market\s*cow/i.test(secText))        return 'cows';
          if (/market\s*bull/i.test(secText))       return 'bulls';
          if (/^bull/i.test(secText))               return 'bulls';
          return null;  // hogs, sows, boars, unknown — ignore
        }

        // Dual-column tracking: when two headers appear back-to-back (no data
        // between them), we know both columns are active. First sale entry on
        // each line → leftCat, second → rightCat.
        let pendingHeaders = [];  // accumulates headers until data arrives
        let leftCat = null;
        let rightCat = null;

        function processSale(m, category) {
          if (!category) return;
          const location = m[1].trim();
          const qty = parseInt(m[2]) || 1;
          const desc = m[3].trim();
          const weight = parseInt(m[4]);
          const rawPrice = m[5];

          const price = normalizePrice(rawPrice);
          if (price === null || weight < 200 || weight > 2500) return;
          if (!CATTLE_DESC_RE.test(desc)) return;

          // Map description to cattle type
          // OCR commonly reads "BLK" as "BIK"/"BiK" (L→I misread)
          const descUpper = desc.toUpperCase();
          let cattleType = 'beef';
          if (/HOL/i.test(descUpper)) cattleType = 'holstein';
          else if (/XBRD|BKRD|BWF|RWF|CROSS/i.test(descUpper)) cattleType = 'crossbred';
          // BLK, BIK, RED, CHAR, WF, ANG, SIM, etc. all default to beef

          let sex = 'steer';
          if (/HFR/.test(descUpper)) sex = 'heifer';
          else if (/BULL|BUL/.test(descUpper)) sex = 'bull';
          else if (/COW/.test(descUpper)) sex = 'cow';

          repSales[category].push({ location, qty, desc, cattleType, sex, weight, price });
        }

        for (const frag of fragments) {
          // Check for section header
          const secMatch = frag.match(SECTION_RE);
          if (secMatch) {
            const cat = mapCategory(secMatch[1].trim().toLowerCase());
            pendingHeaders.push(cat);
            console.log(`[${id}] rep sales header: ${cat} ("${frag.slice(0, 60)}")`);
            continue;
          }

          // Skip header/label rows (Location, Description, Weight, Price)
          if (/^location|^description|^city/i.test(frag)) {
            // Still a header row — don't flush pending headers yet because
            // sub-header rows sit between the section headers and data
            continue;
          }

          // Flush pending headers when we hit actual data
          if (pendingHeaders.length > 0) {
            // Filter out nulls (hogs, etc.) for category assignment
            const cats = pendingHeaders.filter(c => c !== null);
            if (cats.length >= 2) {
              leftCat = cats[0];
              rightCat = cats[1];
              console.log(`[${id}] dual-column mode: left=${leftCat}, right=${rightCat}`);
            } else if (cats.length === 1) {
              leftCat = cats[0];
              rightCat = null;
              console.log(`[${id}] single-column mode: ${leftCat}`);
            }
            // If all headers were null (e.g. all hogs), keep previous categories
            // so interleaved cattle data from the other column isn't lost
            pendingHeaders = [];
          }

          if (!leftCat) continue;

          // Find all sale entries on this line (handles merged two-column rows)
          const matches = [...frag.matchAll(SALE_ROW_RE)];
          if (matches.length === 0) continue;

          if (matches.length >= 2 && rightCat) {
            // Dual column: first match → left, second match → right
            processSale(matches[0], leftCat);
            processSale(matches[1], rightCat);
          } else {
            // Single column or only one match found
            processSale(matches[0], leftCat);
          }
        }

        console.log(`[${id}] rep sales parsed — finished: ${repSales.finished.length}, feeder: ${repSales.feeder.length}, bulls: ${repSales.bulls.length}, cows: ${repSales.cows.length}`);
      } else {
        console.log(`[${id}] no rep OCR text available — skipping rep sales parse`);
      }
    } catch (repErr) {
      console.warn(`[${id}] rep sales OCR parse error (non-fatal): ${repErr.message}`);
    }

    // ── 7. Build weight-class averages from representative sales ─────────
    const finishByWeight = {};  // { "1200-1299": { beef: { sum, count }, crossbred: {...}, holstein: {...} } }
    const feederByWeight = {};
    const headCount = { finished: 0, feeder: 0, bulls: 0, cows: 0 };

    for (const sale of repSales.finished) {
      headCount.finished += sale.qty;
      // Bucket into 100lb weight classes
      const bucket = Math.floor(sale.weight / 100) * 100;
      const range = `${bucket}-${bucket + 99}`;
      if (!finishByWeight[range]) finishByWeight[range] = {};
      if (!finishByWeight[range][sale.cattleType]) finishByWeight[range][sale.cattleType] = { sum: 0, count: 0 };
      finishByWeight[range][sale.cattleType].sum += sale.price * sale.qty;
      finishByWeight[range][sale.cattleType].count += sale.qty;
    }

    for (const sale of repSales.feeder) {
      headCount.feeder += sale.qty;
      const bucket = Math.floor(sale.weight / 100) * 100;
      const range = `${bucket}-${bucket + 99}`;
      if (!feederByWeight[range]) feederByWeight[range] = {};
      if (!feederByWeight[range][sale.cattleType]) feederByWeight[range][sale.cattleType] = { sum: 0, count: 0 };
      feederByWeight[range][sale.cattleType].sum += sale.price * sale.qty;
      feederByWeight[range][sale.cattleType].count += sale.qty;
    }

    for (const sale of repSales.bulls) {
      headCount.bulls += sale.qty;
    }

    for (const sale of repSales.cows) {
      headCount.cows += sale.qty;
    }

    // Convert to averages
    const finishWeightAvgs = [];
    for (const [range, types] of Object.entries(finishByWeight)) {
      for (const [type, data] of Object.entries(types)) {
        finishWeightAvgs.push({
          range: range + ' lbs',
          type,
          avgPrice: parseFloat((data.sum / data.count).toFixed(2)),
          head: data.count
        });
      }
    }
    finishWeightAvgs.sort((a, b) => parseInt(a.range) - parseInt(b.range));

    const feederWeightAvgs = [];
    for (const [range, types] of Object.entries(feederByWeight)) {
      for (const [type, data] of Object.entries(types)) {
        feederWeightAvgs.push({
          range: range + ' lbs',
          type,
          avgPrice: parseFloat((data.sum / data.count).toFixed(2)),
          head: data.count
        });
      }
    }
    feederWeightAvgs.sort((a, b) => parseInt(a.range) - parseInt(b.range));

    console.log(`[${id}] head count — finished: ${headCount.finished}, feeder: ${headCount.feeder}, bulls: ${headCount.bulls}, cows: ${headCount.cows}`);
    console.log(`[${id}] finish weight avgs: ${finishWeightAvgs.length} buckets`);
    console.log(`[${id}] feeder weight avgs: ${feederWeightAvgs.length} buckets`);

    return {
      slaughter, feeder, feederWeights, reportDate, saleDay, liteTestNote,
      repSales: { finishWeightAvgs, feederWeightAvgs, headCount },
      source: 'scraped', error: null
    };

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
        feederWeights: result.feederWeights ?? [],
        saleDay:      result.saleDay ?? null,
        liteTestNote: result.liteTestNote ?? null,
        repSales:     result.repSales ?? null,
        source:    result.source,
      };
      if (result.error) entry.error = result.error;
      if (result.source === 'scraped') barnData.lastSuccess = result.reportDate || todayStr;
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
      slaughter:    recent?.slaughter ?? { beef: null, crossbred: null, holstein: null },
      feeder:       recent?.feeder    ?? { beef: null, crossbred: null, holstein: null, liteTest: false },
      feederWeights: recent?.feederWeights ?? [],
      saleDay:      recent?.saleDay ?? null,
      liteTestNote: recent?.liteTestNote ?? null,
      repSales:     recent?.repSales ?? null,
      trend:        calcTrend(barnData.history),
      source:       recent?.source ?? 'pending',
    });
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexOut, null, 2) + '\n');
  console.log('\n=== index.json updated ===');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
