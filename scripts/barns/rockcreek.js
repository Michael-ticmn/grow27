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

let pdfParseModule;
function ensureDeps() {
  if (!pdfParseModule) pdfParseModule = require('pdf-parse');
}

// Wrapper: handles both pdf-parse v1 (plain function) and v2 (class constructor)
async function parsePdfBuffer(buffer, id) {
  const mod = pdfParseModule;
  // v2 exports the class directly — typeof is 'function' but needs 'new'
  // Try as plain function first; if "cannot be invoked without new", use new
  if (typeof mod === 'function') {
    try {
      return await mod(buffer);                                // v1 plain function
    } catch (e) {
      if (/cannot be invoked without 'new'|is not a constructor/i.test(e.message)) {
        console.log(`[${id}] pdf-parse is a class — using new`);
        const parser = new mod(buffer);
        // v2 class: constructor takes buffer, then call .parse() or .getText()
        if (typeof parser.parse === 'function') return parser.parse();
        if (typeof parser.getText === 'function') {
          const text = await parser.getText();
          return { text, numpages: parser.numpages || '?' };
        }
        // If constructor itself returns a promise-like with text
        if (parser.text !== undefined) return parser;
        // Log available methods for debugging
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(parser))
          .filter(m => m !== 'constructor');
        throw new Error(`PDFParse instance has no known parse method. Methods: ${methods}`);
      }
      throw e;
    }
  }
  if (typeof mod.default === 'function') return mod.default(buffer);
  if (mod.PDFParse) {
    const parser = new mod.PDFParse(buffer);
    if (typeof parser.parse === 'function') return parser.parse();
    return parser;
  }
  throw new Error(`Unknown pdf-parse export shape: ${Object.keys(mod)}`);
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

// ── Parse cattle prices from PDF text ─────────────────────────────────────────
//
// This parser handles common livestock market report formats.  The exact
// layout of Rock Creek's PDFs may require adjustment after seeing real output —
// extensive logging is included to make debugging easy.

function parsePdfText(text, id) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`[${id}] PDF text: ${lines.length} lines, ${text.length} chars`);
  console.log(`[${id}] PDF text preview:\n${lines.slice(0, 40).join('\n')}\n`);

  const slaughter = { beef: null, crossbred: null, holstein: null };
  const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };
  const feederWeights = [];

  let section = null; // 'slaughter' | 'feeder' | null

  for (let i = 0; i < lines.length; i++) {
    const line  = lines[i];
    const lower = line.toLowerCase();

    // ── Section headers ───────────────────────────────────────────────────
    if (/slaughter|fed\s+cattle|finish/i.test(lower) && /cattle|steer|heifer|cow/i.test(lower)) {
      section = 'slaughter';
      console.log(`[${id}] → slaughter section at line ${i}: "${line}"`);
      continue;
    }
    if (/feeder\s+cattle|feeder\s+steer|stocker/i.test(lower)) {
      section = 'feeder';
      console.log(`[${id}] → feeder section at line ${i}: "${line}"`);
      continue;
    }
    // End parsing if we hit non-cattle sections
    if (/hog|swine|sheep|goat|misc/i.test(lower) && /market|sale/i.test(lower)) {
      console.log(`[${id}] → end of cattle sections at line ${i}: "${line}"`);
      break;
    }

    // ── Slaughter prices ──────────────────────────────────────────────────
    if (section === 'slaughter') {
      // Beef / native / choice steers (but NOT dairy or crossbred)
      if (/beef|native|choice|black|angus|steer/i.test(lower)
          && !/dairy|hol|cross|x[\s-]?bred/i.test(lower)
          && !slaughter.beef) {
        const price = extractLinePrice(line);
        if (price) {
          slaughter.beef = price;
          console.log(`[${id}] slaughter.beef = ${JSON.stringify(price)} (line ${i})`);
        }
      }
      // Crossbred / dairy-cross
      if (/cross|x[\s-]?bred|dairy[\s-]?x/i.test(lower) && !slaughter.crossbred) {
        const price = extractLinePrice(line);
        if (price) {
          slaughter.crossbred = price;
          console.log(`[${id}] slaughter.crossbred = ${JSON.stringify(price)} (line ${i})`);
        }
      }
      // Holstein / dairy (but NOT dairy-x / dairy cross)
      if (/holstein|dairy/i.test(lower)
          && !/dairy[\s-]?x|cross/i.test(lower)
          && !slaughter.holstein) {
        const price = extractLinePrice(line);
        if (price) {
          slaughter.holstein = price;
          console.log(`[${id}] slaughter.holstein = ${JSON.stringify(price)} (line ${i})`);
        }
      }
    }

    // ── Feeder prices ─────────────────────────────────────────────────────
    if (section === 'feeder') {
      // Weight-class lines: "500-600#  180.00-195.00" or "500 to 600 lbs  $180-195"
      const weightRe = /(\d{3,4})\s*[-–to]+\s*(\d{3,4})\s*(lbs?|#|pounds?)?/i;
      const wm = line.match(weightRe);
      if (wm) {
        // Strip weight range from line before extracting the price range
        const priceStr = line.replace(wm[0], '');
        const price = extractLinePrice(priceStr);
        if (price) {
          const range = `${wm[1]}–${wm[2]}#`;
          feederWeights.push({ range, price: price.high, types: ['beef'] });
          console.log(`[${id}] feederWeight: ${range} → ${JSON.stringify(price)} (line ${i})`);
          // Use the first (lightest) weight class as the top-of-range feeder price
          if (!feeder.beef) {
            feeder.beef = price;
            console.log(`[${id}] feeder.beef = ${JSON.stringify(price)} (from weight class)`);
          }
        }
        continue;
      }

      // General breed lines
      if (/beef|native|steer/i.test(lower)
          && !/dairy|hol|cross/i.test(lower)
          && !feeder.beef) {
        const price = extractLinePrice(line);
        if (price) {
          feeder.beef = price;
          console.log(`[${id}] feeder.beef = ${JSON.stringify(price)} (line ${i})`);
        }
      }
      if (/holstein|dairy/i.test(lower) && !feeder.holstein) {
        const price = extractLinePrice(line);
        if (price) {
          feeder.holstein = price;
          console.log(`[${id}] feeder.holstein = ${JSON.stringify(price)} (line ${i})`);
        }
      }
    }
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
    const rawResult = await parsePdfBuffer(pdfBuffer, id);
    // Normalize: v1 returns { text, numpages }, v2 may return different shape
    const resultKeys = rawResult ? Object.keys(rawResult) : [];
    console.log(`[${id}] pdf-parse result type: ${typeof rawResult}, keys: ${resultKeys.slice(0, 15)}`);
    const text = rawResult?.text ?? rawResult?.content ?? rawResult?.pages?.map(p => p.text || p.content || '').join('\n') ?? '';
    const numpages = rawResult?.numpages ?? rawResult?.numPages ?? rawResult?.pages?.length ?? '?';
    pdfData = { text, numpages };
    console.log(`[${id}] PDF parsed — ${numpages} pages, ${text.length} chars`);
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
