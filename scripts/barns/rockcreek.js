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

function parsePdfText(text, id) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`[${id}] PDF text: ${lines.length} lines, ${text.length} chars`);
  console.log(`[${id}] PDF text preview:\n${lines.slice(0, 40).join('\n')}\n`);

  const slaughter = { beef: null, crossbred: null, holstein: null };
  const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };
  const feederWeights = [];

  const fullText = lines.join('\n');

  // ── Slaughter: "Day Choice & Prime" + two prices ──────────────────────
  // Matches prices glued together: "220.00232.50" or with space: "220.00 232.50"
  const primeRe = /Day Choice & Prime\s*(\d+\.\d{2})\s*(\d+\.\d{2})/gi;
  const primeHits = [...fullText.matchAll(primeRe)];
  console.log(`[${id}] "Day Choice & Prime" matches: ${primeHits.length}`);
  primeHits.forEach((m, i) => console.log(`[${id}]   [${i}] ${m[1]} – ${m[2]}`));

  if (primeHits.length >= 1) {
    // First = Beef Steers
    slaughter.beef = { low: parseFloat(primeHits[0][1]), high: parseFloat(primeHits[0][2]) };
    console.log(`[${id}] slaughter.beef (steers) = ${JSON.stringify(slaughter.beef)}`);
  }
  if (primeHits.length >= 2) {
    // Second = Beef Heifers — widen the beef range if different
    const hLow = parseFloat(primeHits[1][1]), hHigh = parseFloat(primeHits[1][2]);
    if (slaughter.beef) {
      slaughter.beef.low  = Math.min(slaughter.beef.low, hLow);
      slaughter.beef.high = Math.max(slaughter.beef.high, hHigh);
    }
    console.log(`[${id}] slaughter.beef (+ heifers) = ${JSON.stringify(slaughter.beef)}`);
  }
  if (primeHits.length >= 3) {
    // Third = Holstein Steers
    slaughter.holstein = { low: parseFloat(primeHits[2][1]), high: parseFloat(primeHits[2][2]) };
    console.log(`[${id}] slaughter.holstein = ${JSON.stringify(slaughter.holstein)}`);
  }

  // ── Feeder: "NNN-NNN lbs" + two prices ────────────────────────────────
  // Prices may be glued: "400-800 lbs230.00310.00"
  // The comma in "3,660.00" is a PDF artifact — strip commas before parsing
  const weightRe = /(\d{3,4})\s*-\s*(\d{3,4})\s*lbs\s*(\d[\d,]*\.\d{2})\s*(\d+\.\d{2})/gi;
  let wm;
  while ((wm = weightRe.exec(fullText)) !== null) {
    const wLow = parseInt(wm[1]), wHigh = parseInt(wm[2]);
    const pLow  = normalizePrice(wm[3].replace(/,/g, ''));
    const pHigh = normalizePrice(wm[4]);
    if (pLow !== null && pHigh !== null) {
      const range = `${wLow}–${wHigh}#`;
      feederWeights.push({ range, price: pHigh, types: ['beef'] });
      console.log(`[${id}] feederWeight: ${range} → ${pLow}–${pHigh}`);
    } else {
      console.log(`[${id}] feederWeight SKIP: ${wm[1]}-${wm[2]} lbs → raw ${wm[3]}, ${wm[4]} (normalized: ${pLow}, ${pHigh})`);
    }
  }

  // Set feeder.beef from the lightest weight classes (highest $/cwt)
  if (feederWeights.length > 0) {
    const prices = feederWeights.map(w => w.price);
    feeder.beef = { low: Math.min(...prices), high: Math.max(...prices) };
    console.log(`[${id}] feeder.beef = ${JSON.stringify(feeder.beef)} (from ${feederWeights.length} weight classes)`);
  }

  return { slaughter, feeder, feederWeights };
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
  const { slaughter, feeder, feederWeights } = parsePdfText(pdfData.text, id);

  const hasSlaughter = Object.values(slaughter).some(v => v !== null);
  const hasFeeder    = feeder.beef !== null || feeder.holstein !== null;
  console.log(`[${id}] parse result — hasSlaughter=${hasSlaughter}, hasFeeder=${hasFeeder}`);

  if (!hasSlaughter && !hasFeeder) {
    // Dump full text for debugging — this will appear in GitHub Actions logs
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
    saleDay:      null,
    liteTestNote: null,
    repSales:     null,
    hogs:         null,
    source:       'scraped',
    error:        null,
  };
}

module.exports = { parse };
