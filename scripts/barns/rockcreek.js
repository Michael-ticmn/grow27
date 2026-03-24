// scripts/barns/rockcreek.js
// Rock Creek Livestock Market — Pine City MN
// Parses PDF market reports linked from their website.
//
// Reports are published at irregular intervals as PDFs.
// URL pattern: https://rockcreeklivestockmarket.com/wp-content/uploads/YYYY/MM/YYYY-MM-DD-mr.pdf
//
// Strategy: scrape index page for PDF links, select newest unprocessed,
// download via Puppeteer, extract text with pdf-parse, parse prices.
//
// Date filter phases (controlled by DEV_MODE + history state):
//   Phase 1 (DEV_MODE=true):  2 most recent PDFs — for validation
//   Phase 2 (no history):     All YTD PDFs — catch-up run
//   Phase 3 (history exists): Only PDFs newer than last captured
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs   = require('fs');
const path = require('path');

let pdfParse;
function ensureDeps() {
  if (!pdfParse) pdfParse = require('pdf-parse'); // v1.1.1 — returns async function
}

const { normalizePrice, extractLinePrice } = require('../scrape-barns');

const ROOT       = path.join(__dirname, '..', '..');
const PRICES_DIR = path.join(ROOT, 'data', 'prices');

// ── Configuration ─────────────────────────────────────────────────────────────
const DEV_MODE = true;  // flip to false once parser is validated
const PDF_PATTERN = /\/wp-content\/uploads\/\d{4}\/\d{2}\/(\d{4}-\d{2}-\d{2})-mr\.pdf/i;

// ── PDF link discovery ────────────────────────────────────────────────────────

function discoverPdfs($, id) {
  const pdfs = [];
  const seen = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const m = href.match(PDF_PATTERN);
    if (!m) return;
    const date = m[1];
    if (seen.has(date)) return;
    seen.add(date);

    const url = href.startsWith('http')
      ? href
      : `https://rockcreeklivestockmarket.com${href}`;
    pdfs.push({ url, date });
  });

  // Also check for links that aren't <a> tags — some sites put URLs in text
  // (fallback: scan raw HTML)
  if (pdfs.length === 0) {
    const htmlStr = $.html ? $.html() : '';
    const re = new RegExp(PDF_PATTERN.source, 'gi');
    let match;
    while ((match = re.exec(htmlStr)) !== null) {
      const date = match[1];
      if (seen.has(date)) continue;
      seen.add(date);
      const fullMatch = match[0];
      const url = fullMatch.startsWith('http')
        ? fullMatch
        : `https://rockcreeklivestockmarket.com${fullMatch}`;
      pdfs.push({ url, date });
    }
    if (pdfs.length > 0) {
      console.log(`[${id}] found ${pdfs.length} PDFs via HTML scan fallback`);
    }
  }

  return pdfs.sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

// ── Date filter — select which PDFs to process ────────────────────────────────

function selectPdfs(pdfs, id) {
  if (DEV_MODE) {
    const selected = pdfs.slice(0, 2);
    console.log(`[${id}] DEV_MODE — selecting ${selected.length} most recent PDFs`);
    selected.forEach(p => console.log(`[${id}]   → ${p.date}`));
    return selected;
  }

  // Check existing history for last captured date
  let lastCaptured = null;
  try {
    const histPath = path.join(PRICES_DIR, `${id}.json`);
    const data = JSON.parse(fs.readFileSync(histPath, 'utf8'));
    const scraped = (data.history || [])
      .filter(e => e.source === 'scraped')
      .sort((a, b) => b.date.localeCompare(a.date));
    if (scraped.length > 0) lastCaptured = scraped[0].date;
  } catch (e) { /* no history file */ }

  if (lastCaptured) {
    // Phase 3: incremental — only PDFs newer than last captured
    const selected = pdfs.filter(p => p.date > lastCaptured);
    console.log(`[${id}] Phase 3 — last captured: ${lastCaptured}, ${selected.length} newer PDFs`);
    selected.forEach(p => console.log(`[${id}]   → ${p.date}`));
    return selected;
  }

  // Phase 2: year-to-date catch-up
  const ytdStart = `${new Date().getFullYear()}-01-01`;
  const selected = pdfs.filter(p => p.date >= ytdStart);
  console.log(`[${id}] Phase 2 — YTD from ${ytdStart}, ${selected.length} PDFs`);
  selected.forEach(p => console.log(`[${id}]   → ${p.date}`));
  return selected;
}

// ── Download a PDF via native HTTPS ───────────────────────────────────────────
// Puppeteer's page.goto() on PDF URLs triggers Chrome's PDF viewer, returning
// the viewer HTML (~500 bytes) instead of the raw PDF.  Use Node's https module
// to get the actual file bytes.

function downloadPdf(browser, url, id) {
  const https = require('https');
  const http  = require('http');
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, { timeout: 30000 }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[${id}] PDF redirect → ${res.headers.location}`);
        return downloadPdf(browser, res.headers.location, id).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        console.log(`[${id}] downloaded PDF — ${buffer.length} bytes`);
        resolve(buffer);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Parse cattle prices from Rock Creek PDF text ──────────────────────────────
//
// Rock Creek PDFs are two-column layouts.  pdf-parse interleaves the columns,
// so line-by-line section tracking is unreliable.  Instead we pattern-match
// the full text for known price formats:
//
//   Slaughter: "Day Choice & Prime" followed by two glued prices (220.00232.50)
//              Appears 3 times: Beef Steers, Beef Heifers, Holstein Steers
//
//   Feeder:    "NNN-NNN lbs" followed by two glued prices (470.00530.00)
//              Two sets: Steers & Bulls, then Heifers
//
//   Rep Sales: "Representative Sales: <category>" then rows of
//              Location+Desc+Weight(comma-fmt)+Qty+Price glued together

function parsePdfText(text, id) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`[${id}] PDF text: ${lines.length} lines, ${text.length} chars`);
  console.log(`[${id}] PDF text preview:\n${lines.slice(0, 40).join('\n')}\n`);

  const slaughter = { beef: null, crossbred: null, holstein: null };
  const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };
  const feederWeights = [];
  const fullText = lines.join('\n');

  // ── Slaughter: "Day Choice & Prime" + two prices ──────────────────────
  const primeRe = /Day Choice & Prime\s*(\d+\.\d{2})\s*(\d+\.\d{2})/gi;
  const primeHits = [...fullText.matchAll(primeRe)];
  console.log(`[${id}] "Day Choice & Prime" matches: ${primeHits.length}`);
  primeHits.forEach((m, i) => console.log(`[${id}]   [${i}] ${m[1]} – ${m[2]}`));

  if (primeHits.length >= 1) {
    slaughter.beef = { low: parseFloat(primeHits[0][1]), high: parseFloat(primeHits[0][2]) };
    console.log(`[${id}] slaughter.beef (steers) = ${JSON.stringify(slaughter.beef)}`);
  }
  if (primeHits.length >= 2) {
    const hLow = parseFloat(primeHits[1][1]), hHigh = parseFloat(primeHits[1][2]);
    if (slaughter.beef) {
      slaughter.beef.low  = Math.min(slaughter.beef.low, hLow);
      slaughter.beef.high = Math.max(slaughter.beef.high, hHigh);
    }
    console.log(`[${id}] slaughter.beef (+ heifers) = ${JSON.stringify(slaughter.beef)}`);
  }
  if (primeHits.length >= 3) {
    slaughter.holstein = { low: parseFloat(primeHits[2][1]), high: parseFloat(primeHits[2][2]) };
    console.log(`[${id}] slaughter.holstein = ${JSON.stringify(slaughter.holstein)}`);
  }

  // ── Feeder: "NNN-NNN lbs" + two prices ────────────────────────────────
  // Rock Creek feeder section has three subsections:
  //   Holstein Steers (wide ranges: 400-800, 800-1100)
  //   Beef Steers & Bulls (100-lb increments: 300-400 … 800-900)
  //   Beef Heifers (same weight ranges, lower prices)
  //
  // normalizePrice caps at 500¢ but light calves (300-400#) sell above that,
  // so we use a custom validator allowing up to 600¢.
  function normalizeFeederPrice(raw) {
    const cleaned = raw.replace(/,/g, '');
    const v = parseFloat(cleaned);
    if (isNaN(v)) return null;
    if (v >= 100 && v <= 600) return parseFloat(v.toFixed(2));
    // PDF artifact: "3,660.00" → 3660 → /10 = 366 (left-column digit bleed)
    if (v > 600 && v < 10000) {
      const d10 = v / 10;
      if (d10 >= 100 && d10 <= 600) return parseFloat(d10.toFixed(2));
    }
    return null;
  }

  // Use lookbehind (?<!\d\.) to avoid matching "210.00600" as "0600",
  // but still allow "00600" — parseInt strips the leading zero.
  const weightRe = /(?<!\d\.)(\d{3,4})\s*-\s*(\d{3,4})\s*lbs\s*(\d[\d,]*\.\d{2})\s*(\d+\.\d{2})/gi;
  let wm;
  // Track seen ranges to separate steers (first occurrence) from heifers (second)
  const seenRanges = new Set();
  while ((wm = weightRe.exec(fullText)) !== null) {
    const wLow = parseInt(wm[1]), wHigh = parseInt(wm[2]);
    const pLow  = normalizeFeederPrice(wm[3]);
    const pHigh = normalizeFeederPrice(wm[4]);
    if (pLow !== null && pHigh !== null) {
      const range = `${wLow}–${wHigh}#`;
      // Wide ranges (span 400+ lbs) → Holstein; narrow (100-lb) → Beef
      const isHolstein = (wHigh - wLow) >= 300;
      const types = isHolstein ? ['holstein'] : ['beef'];
      // Label steers vs heifers for duplicate beef ranges
      let label = isHolstein ? 'hol' : 'steers';
      if (!isHolstein && seenRanges.has(range)) label = 'heifers';
      seenRanges.add(range);
      feederWeights.push({ range, low: pLow, price: pHigh, types, label });
      console.log(`[${id}] feederWeight: ${range} → ${pLow}–${pHigh} [${types}, ${label}]`);
    } else {
      console.log(`[${id}] feederWeight SKIP: ${wm[1]}-${wm[2]} lbs → raw ${wm[3]}, ${wm[4]} (normalized: ${pLow}, ${pHigh})`);
    }
  }

  // Set feeder.beef and feeder.holstein from their respective weight classes
  const beefWeights = feederWeights.filter(w => w.types.includes('beef'));
  const holWeights  = feederWeights.filter(w => w.types.includes('holstein'));
  if (beefWeights.length > 0) {
    const prices = beefWeights.map(w => w.price);
    feeder.beef = { low: Math.min(...prices), high: Math.max(...prices) };
    console.log(`[${id}] feeder.beef = ${JSON.stringify(feeder.beef)} (from ${beefWeights.length} weight classes)`);
  }
  if (holWeights.length > 0) {
    const prices = holWeights.map(w => w.price);
    feeder.holstein = { low: Math.min(...prices), high: Math.max(...prices) };
    console.log(`[${id}] feeder.holstein = ${JSON.stringify(feeder.holstein)} (from ${holWeights.length} weight classes)`);
  }

  // ── Representative Sales ──────────────────────────────────────────────
  // Sections: "Representative Sales: Finished Cattle", "Market Cows",
  //           "Market Bulls", "Sheep & Goats", "Hogs"
  // Row format (all glued): Location + Desc + Weight(X,XXX) + Qty + Price(XXX.XX)
  const repSales = parseRepSales(lines, id);

  return { slaughter, feeder, feederWeights, repSales };
}

// ── Representative Sales parser ─────────────────────────────────────────────

function parseRepSales(lines, id) {
  const sales = { finished: [], cows: [], bulls: [] };

  // Rock Creek's two-column PDF merges "Representative Sales: Market Cows"
  // and "Market Bulls" headers on consecutive lines, then interleaves the data.
  // Same for "Finished Cattle" + "Sheep & Goats".  Rather than tracking sections,
  // we classify each row by its description content.

  let inRepSales = false;

  // Row pattern: everything ends with Weight(comma-fmt) + Qty + Price
  // e.g. "IsleRed/RWF/Tan Steers1,62211232.50"
  //   → weight=1622, qty=11, price=232.50
  const ROW_RE = /^(.+?)(\d{1,2},\d{3})(\d+?)(\d{2,3}\.\d{2})$/;

  for (const line of lines) {
    // Enter rep sales mode on any "Representative Sales:" header
    if (/^Representative Sales:/i.test(line)) {
      inRepSales = true;
      console.log(`[${id}] rep header: "${line}"`);
      continue;
    }

    if (!inRepSales) continue;

    // Skip header/note lines
    if (/^Location|^\*|^\(Sold|^Description/i.test(line)) continue;

    // Try to match a sale row
    const rm = line.match(ROW_RE);
    if (!rm) continue;

    const desc   = rm[1];
    const weight = parseInt(rm[2].replace(/,/, ''));
    const qty    = parseInt(rm[3]);
    const price  = parseFloat(rm[4]);

    // Sanity checks
    if (weight < 400 || weight > 3000) continue;
    if (qty < 1 || qty > 200) continue;
    if (price < 50 || price > 500) continue;

    // Skip non-cattle (sheep, goats, hogs)
    if (/Goat|Lamb|Ewe|Nanny|Billy|Wether|Kid|Sow|Butcher|MKT|Hog/i.test(desc)) continue;

    // Classify by description — cow, bull, or finished (steer/heifer)
    let category;
    if (/Cow/i.test(desc))                    category = 'cows';
    else if (/Bull/i.test(desc) && !/Steer|Heifer/i.test(desc)) category = 'bulls';
    else                                      category = 'finished';

    // Identify cattle type from description
    let cattleType = 'beef';
    if (/Holstein|Hol\b/i.test(desc))                                  cattleType = 'holstein';
    else if (/BWF|RWF|Red & White|Black & White|Tan|Cross/i.test(desc)) cattleType = 'crossbred';

    // Identify sex
    let sex = 'steer';
    if (/Heifer|Hfr/i.test(desc))      sex = 'heifer';
    else if (/Cow/i.test(desc))         sex = 'cow';
    else if (/Bull/i.test(desc))        sex = 'bull';
    else if (/St\/H|Steer.*Heifer/i.test(desc)) sex = 'mixed';

    sales[category].push({ desc: desc.trim(), cattleType, sex, weight, qty, price });
    console.log(`[${id}] rep ${category}: ${qty}hd ${cattleType} ${sex} ${weight}# @ ${price} ("${desc.trim().slice(0, 30)}")`);
  }

  console.log(`[${id}] rep sales — finished: ${sales.finished.length}, cows: ${sales.cows.length}, bulls: ${sales.bulls.length}`);

  // Build weight-class averages (matching central.js output shape)
  const headCount = { finished: 0, feeder: 0, bulls: 0, cows: 0 };

  function buildWeightAvgs(entries, byType) {
    const buckets = {};
    let totalHead = 0;
    for (const s of entries) {
      totalHead += s.qty;
      const bucket = Math.floor(s.weight / 100) * 100;
      const range = `${bucket}-${bucket + 99}`;
      const key = byType ? `${range}|${s.cattleType}` : range;
      if (!buckets[key]) buckets[key] = { range, type: s.cattleType, sum: 0, count: 0 };
      buckets[key].sum += s.price * s.qty;
      buckets[key].count += s.qty;
    }
    const avgs = Object.values(buckets).map(b => ({
      range: b.range + ' lbs',
      ...(byType ? { type: b.type } : {}),
      avgPrice: parseFloat((b.sum / b.count).toFixed(2)),
      head: b.count,
    })).sort((a, b) => parseInt(a.range) - parseInt(b.range));
    return { avgs, totalHead };
  }

  const finish = buildWeightAvgs(sales.finished, true);
  headCount.finished = finish.totalHead;

  const bulls = buildWeightAvgs(sales.bulls, false);
  headCount.bulls = bulls.totalHead;

  const cows = buildWeightAvgs(sales.cows, false);
  headCount.cows = cows.totalHead;

  console.log(`[${id}] rep avgs — finish: ${finish.avgs.length} buckets (${headCount.finished} hd), bulls: ${bulls.avgs.length} (${headCount.bulls} hd), cows: ${cows.avgs.length} (${headCount.cows} hd)`);

  if (headCount.finished === 0 && headCount.bulls === 0 && headCount.cows === 0) {
    return null;
  }

  return {
    finishWeightAvgs: finish.avgs,
    feederWeightAvgs: [],  // Rock Creek PDF doesn't have individual feeder sale lines
    bullsWeightAvgs: bulls.avgs,
    cowsWeightAvgs: cows.avgs,
    headCount,
  };
}

// ── Main parse function (called by orchestrator) ──────────────────────────────

async function parse({ id, browser, html, $ }) {
  ensureDeps();

  // 1. Discover PDF links on the index page
  const allPdfs = discoverPdfs($, id);
  console.log(`[${id}] discovered ${allPdfs.length} PDF links`);
  allPdfs.slice(0, 10).forEach(p => console.log(`[${id}]   ${p.date}: ${p.url}`));

  if (allPdfs.length === 0) {
    console.error(`[${id}] no PDF links found on index page`);
    return {
      slaughter: null, feeder: null,
      source: 'fetch_failed',
      error: 'no PDF links matching pattern found on index page',
    };
  }

  // 2. Select PDFs by date-filter phase
  const selected = selectPdfs(allPdfs, id);
  if (selected.length === 0) {
    console.log(`[${id}] no new PDFs to process — all caught up`);
    return {
      slaughter: null, feeder: null,
      reportDate: allPdfs[0].date,
      source: 'scraped',
      error: null,
    };
  }

  // 3. Process the most recent selected PDF
  //    (orchestrator stores one entry per parse() call;
  //     successive daily runs capture one new PDF each)
  const target = selected[0]; // selected is sorted newest-first
  console.log(`\n[${id}] ▸ processing PDF: ${target.date} — ${target.url}`);

  let pdfBuffer;
  try {
    pdfBuffer = await downloadPdf(browser, target.url, id);
  } catch (dlErr) {
    console.error(`[${id}] PDF download failed: ${dlErr.message}`);
    return {
      slaughter: null, feeder: null,
      reportDate: target.date,
      source: 'fetch_failed',
      error: `PDF download failed: ${dlErr.message}`,
    };
  }

  let pdfData;
  try {
    pdfData = await pdfParse(pdfBuffer);
    console.log(`[${id}] PDF parsed — ${pdfData.numpages} pages, ${pdfData.text.length} chars`);
  } catch (parseErr) {
    console.error(`[${id}] pdf-parse failed: ${parseErr.message}`);
    return {
      slaughter: null, feeder: null,
      reportDate: target.date,
      source: 'fetch_failed',
      error: `PDF text extraction failed: ${parseErr.message}`,
    };
  }

  // 4. Extract prices from PDF text
  const { slaughter, feeder, feederWeights, repSales } = parsePdfText(pdfData.text, id);

  const hasSlaughter = Object.values(slaughter).some(v => v !== null);
  const hasFeeder    = feeder.beef !== null || feeder.holstein !== null;
  console.log(`[${id}] parse result — hasSlaughter=${hasSlaughter}, hasFeeder=${hasFeeder}, hasRepSales=${repSales != null}`);

  if (!hasSlaughter && !hasFeeder) {
    console.error(`[${id}] ✗ no prices parsed from PDF ${target.date}`);
    console.log(`[${id}] FULL PDF TEXT:\n${'─'.repeat(60)}\n${pdfData.text}\n${'─'.repeat(60)}`);
    return {
      slaughter: null, feeder: null,
      reportDate: target.date,
      source: 'fetch_failed',
      error: 'no prices parsed from PDF text',
    };
  }

  // 5. Return standard result shape
  return {
    slaughter,
    feeder,
    feederWeights,
    reportDate: target.date,
    saleDay: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(target.date + 'T12:00:00').getDay()],
    liteTestNote: null,
    repSales,
    hogs:         null,
    source:       'scraped',
    error:        null,
  };
}

module.exports = { parse };
