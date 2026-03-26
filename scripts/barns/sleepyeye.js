// scripts/barns/sleepyeye.js
// Sleepy Eye Auction Market — Sleepy Eye MN
// Parses HTML market reports embedded in a WordPress Advanced iFrame plugin.
//
// The report page at /market-reports/ contains an iframe with HTML tables
// organized by cattle category (e.g. "CATTLE - Fats", "CATTLE - FatHfr").
// Date selector tabs at the bottom switch reports; we parse the currently
// displayed report and extract the date from the report heading (M/D/YYYY).
//
// Category mapping:
//   Slaughter: Fats, FatHfr, FatStr (finished cattle, weights 1100+)
//   Feeder:    StrClf, HfrClf, BullClf, FdrStr, FdrHfr, Feeder* (lighter cattle)
//   Skipped:   BrCow, Bull, BC-HC, Hay (breeding stock, baby calves, hay)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── Category classification ─────────────────────────────────────────────────

// Slaughter = finished/fat cattle
const SLAUGHTER_RE = /^(Fats|FatHfr|FatStr|Fat\s*Steer|Fat\s*Heifer)/i;

// Feeder = calves and lighter-weight growing cattle
const FEEDER_RE = /^(Fdr|Feeder|StrClf|HfrClf|BullClf|Steer\s*C|Heifer\s*C|Bull\s*C)/i;

// Skip these categories entirely
const SKIP_RE = /^(BrCow|Bred|Bull$|BC-HC|Baby|Hay|Cow$|MktCow|Pair)/i;

function classifyCategory(cat) {
  if (SLAUGHTER_RE.test(cat)) return 'slaughter';
  if (FEEDER_RE.test(cat)) return 'feeder';
  if (SKIP_RE.test(cat)) return 'skip';
  return 'unknown';
}

// ── Main parse function ─────────────────────────────────────────────────────

async function parse({ id, browser }) {
  const page = await browser.newPage();
  let reportHtml;

  try {
    console.log(`[${id}] navigating to market reports page...`);
    await page.goto('https://sleepyeyeauctionmarket.com/market-reports/', {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    // Wait for the Advanced iFrame to appear
    await page.waitForSelector('#advanced_iframe', { timeout: 20000 });
    console.log(`[${id}] iframe element found`);

    // Give iframe content time to load
    await new Promise(r => setTimeout(r, 3000));

    // Try to access iframe content via contentFrame()
    const iframeEl = await page.$('#advanced_iframe');
    if (!iframeEl) throw new Error('iframe element not found');

    // First try: get src and navigate directly (more reliable)
    const iframeSrc = await page.evaluate(el => el.src || '', iframeEl);
    let frame;

    if (iframeSrc && iframeSrc !== 'about:blank') {
      console.log(`[${id}] iframe src: ${iframeSrc}`);
      // Navigate a new page to the iframe src for cleaner access
      const iframePage = await browser.newPage();
      try {
        await iframePage.goto(iframeSrc, { waitUntil: 'networkidle2', timeout: 30000 });
        reportHtml = await iframePage.content();
      } finally {
        await iframePage.close();
      }
    } else {
      // Fallback: access via contentFrame
      frame = await iframeEl.contentFrame();
      if (!frame) throw new Error('iframe content not accessible (no src, no contentFrame)');
      await frame.waitForSelector('body', { timeout: 10000 });
      reportHtml = await frame.content();
    }

    console.log(`[${id}] got report content: ${reportHtml.length} chars`);
  } catch (err) {
    console.error(`[${id}] iframe access failed: ${err.message}`);
    return {
      slaughter: null, feeder: null,
      source: 'fetch_failed',
      error: `iframe access failed: ${err.message}`,
    };
  } finally {
    await page.close();
  }

  // Log a preview of the content for debugging
  const textPreview = reportHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500);
  console.log(`[${id}] content preview: ${textPreview}`);

  // Parse the HTML
  const cheerio = require('cheerio');
  const $r = cheerio.load(reportHtml);

  // ── Extract report date (M/D/YYYY format from heading) ──────────────────
  let reportDate = null;
  const dateMatch = reportHtml.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dateMatch) {
    const mm = dateMatch[1].padStart(2, '0');
    const dd = dateMatch[2].padStart(2, '0');
    reportDate = `${dateMatch[3]}-${mm}-${dd}`;
    console.log(`[${id}] report date: ${reportDate}`);
  }

  // ── Parse all CATTLE categories ─────────────────────────────────────────
  // Structure: bold heading "CATTLE - <Type>" followed by a table with rows
  // Each row: Descr | Head | Avg_Wt | $/CWT | $/Head

  const slaughter = { beef: null, crossbred: null, holstein: null };
  const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };
  const feederWeights = [];

  const slaughterPrices = [];
  const feederPrices = [];
  const allCategories = [];

  // Strategy: find all text that looks like category headers, then extract
  // table data near each header. The HTML could be <table> based or <div> based.

  // Approach 1: Look for tables — each category section has its own table
  const tables = $r('table');
  console.log(`[${id}] found ${tables.length} tables`);

  // Approach 2: Look for category headers in bold/strong/heading text
  const bodyText = $r('body').text();
  const catMatches = [...bodyText.matchAll(/CATTLE\s*[-–—]\s*(\w+)/gi)];
  console.log(`[${id}] found ${catMatches.length} category headers: ${catMatches.map(m => m[1]).join(', ')}`);

  // Parse tables — look for rows with numeric data (Head, Avg_Wt, $/CWT, $/Head)
  // Each table row should have: description text, head count, avg weight, price/cwt, price/head
  const ROW_RE = /(\d+(?:,\d{3})*(?:\.\d{2})?)/g;

  tables.each((ti, table) => {
    const rows = $r(table).find('tr');
    if (rows.length === 0) return;

    // Check if this table has a category header above it or in its first row
    let category = null;

    // Look for "CATTLE - XXX" in the table or preceding elements
    const tableText = $r(table).text();
    const catMatch = tableText.match(/CATTLE\s*[-–—]\s*(\w+)/i);
    if (catMatch) {
      category = catMatch[1];
    } else {
      // Check previous sibling or parent for category
      const prev = $r(table).prev();
      const prevText = prev.text() || '';
      const prevMatch = prevText.match(/CATTLE\s*[-–—]\s*(\w+)/i);
      if (prevMatch) category = prevMatch[1];
    }

    if (!category) return;

    const classification = classifyCategory(category);
    allCategories.push({ category, classification, rows: rows.length - 1 });
    console.log(`[${id}] table ${ti}: CATTLE - ${category} → ${classification} (${rows.length - 1} data rows)`);

    if (classification === 'skip' || classification === 'unknown') return;

    // Parse data rows (skip header row)
    rows.each((ri, row) => {
      if (ri === 0) return; // skip header

      const cells = $r(row).find('td, th');
      if (cells.length < 4) return;

      const cellTexts = [];
      cells.each((_, cell) => cellTexts.push($r(cell).text().trim()));

      // Expected: [Descr, Head, Avg_Wt, $/CWT, $/Head]
      const desc    = cellTexts[0] || '';
      const head    = parseInt((cellTexts[1] || '').replace(/,/g, ''));
      const avgWt   = parseInt((cellTexts[2] || '').replace(/,/g, ''));
      const priceCwt = parseFloat((cellTexts[3] || '').replace(/[$,]/g, ''));
      const priceHd  = parseFloat((cellTexts[4] || '').replace(/[$,]/g, ''));

      if (isNaN(priceCwt) || priceCwt < 10 || priceCwt > 500) return;
      if (isNaN(avgWt) || avgWt < 50) return;
      if (isNaN(head) || head < 1) return;

      console.log(`[${id}]   ${desc} | ${head}hd | ${avgWt}# | $${priceCwt}/cwt | $${priceHd}/hd → ${classification}`);

      if (classification === 'slaughter') {
        slaughterPrices.push({ desc, head, avgWt, priceCwt, priceHd, category });
      } else if (classification === 'feeder') {
        feederPrices.push({ desc, head, avgWt, priceCwt, priceHd, category });
      }
    });
  });

  // ── If table approach found nothing, try text-based parsing ─────────────
  if (slaughterPrices.length === 0 && feederPrices.length === 0) {
    console.log(`[${id}] table parsing found no data, trying text-based approach...`);

    // Split body text into lines and look for price patterns
    const lines = bodyText.split('\n').map(l => l.trim()).filter(Boolean);
    let currentCategory = null;
    let currentClassification = null;
    let inHeader = false;

    for (const line of lines) {
      // Check for category header
      const catM = line.match(/CATTLE\s*[-–—]\s*(\w+)/i);
      if (catM) {
        currentCategory = catM[1];
        currentClassification = classifyCategory(currentCategory);
        inHeader = true;
        console.log(`[${id}] text: category ${currentCategory} → ${currentClassification}`);
        continue;
      }

      // Skip header line (Descr, Head, etc.)
      if (/^\s*Descr/i.test(line)) { inHeader = false; continue; }
      if (inHeader) continue;
      if (!currentCategory || currentClassification === 'skip') continue;

      // Try to parse a data line: "Color Fats 6 1528 235.50 $3,599.23"
      // or "Blk FatHfr 1 1370 234.00 $3,205.80"
      const dataMatch = line.match(/^(.+?)\s+(\d+)\s+(\d{3,4})\s+([\d,.]+)\s+\$?([\d,.]+)/);
      if (!dataMatch) continue;

      const desc = dataMatch[1].trim();
      const head = parseInt(dataMatch[2]);
      const avgWt = parseInt(dataMatch[3]);
      const priceCwt = parseFloat(dataMatch[4].replace(/,/g, ''));
      const priceHd = parseFloat(dataMatch[5].replace(/,/g, ''));

      if (isNaN(priceCwt) || priceCwt < 10 || priceCwt > 500) continue;
      if (isNaN(avgWt) || avgWt < 50) continue;

      console.log(`[${id}]   text: ${desc} | ${head}hd | ${avgWt}# | $${priceCwt}/cwt → ${currentClassification}`);

      if (currentClassification === 'slaughter') {
        slaughterPrices.push({ desc, head, avgWt, priceCwt, priceHd, category: currentCategory });
      } else if (currentClassification === 'feeder') {
        feederPrices.push({ desc, head, avgWt, priceCwt, priceHd, category: currentCategory });
      }
    }
  }

  // ── Build slaughter {low, high} from all slaughter entries ──────────────
  if (slaughterPrices.length > 0) {
    const prices = slaughterPrices.map(e => e.priceCwt);
    slaughter.beef = {
      low:  parseFloat(Math.min(...prices).toFixed(2)),
      high: parseFloat(Math.max(...prices).toFixed(2)),
    };
    console.log(`[${id}] slaughter.beef = ${JSON.stringify(slaughter.beef)} (from ${slaughterPrices.length} rows)`);
  }

  // ── Build feeder {low, high} and feederWeights ──────────────────────────
  if (feederPrices.length > 0) {
    const prices = feederPrices.map(e => e.priceCwt);
    feeder.beef = {
      low:  parseFloat(Math.min(...prices).toFixed(2)),
      high: parseFloat(Math.max(...prices).toFixed(2)),
    };
    console.log(`[${id}] feeder.beef = ${JSON.stringify(feeder.beef)} (from ${feederPrices.length} rows)`);

    // Group feeder entries by weight range (100-lb buckets)
    const buckets = {};
    for (const e of feederPrices) {
      const bucket = Math.floor(e.avgWt / 100) * 100;
      const range = `${bucket}–${bucket + 99}#`;
      if (!buckets[range]) buckets[range] = { prices: [], types: ['beef'] };
      buckets[range].prices.push(e.priceCwt);
    }
    for (const [range, data] of Object.entries(buckets)) {
      feederWeights.push({
        range,
        low:   parseFloat(Math.min(...data.prices).toFixed(2)),
        price: parseFloat(Math.max(...data.prices).toFixed(2)),
        types: data.types,
      });
    }
    feederWeights.sort((a, b) => parseInt(a.range) - parseInt(b.range));
    console.log(`[${id}] feederWeights: ${feederWeights.length} buckets`);
  }

  const hasSlaughter = slaughter.beef !== null;
  const hasFeeder = feeder.beef !== null;

  if (!hasSlaughter && !hasFeeder) {
    console.error(`[${id}] no prices extracted from report`);
    return {
      slaughter: null, feeder: null,
      reportDate,
      source: 'fetch_failed',
      error: 'no prices found in report HTML',
    };
  }

  // Determine sale day from report date
  let saleDay = null;
  if (reportDate) {
    const d = new Date(reportDate + 'T12:00:00');
    saleDay = DAYS[d.getDay()];
  }

  console.log(`[${id}] result — slaughter: ${hasSlaughter}, feeder: ${hasFeeder}, date: ${reportDate}, day: ${saleDay}`);
  console.log(`[${id}] categories found: ${allCategories.map(c => `${c.category}(${c.classification})`).join(', ')}`);

  return {
    slaughter,
    feeder,
    feederWeights,
    reportDate,
    saleDay,
    liteTestNote: null,
    repSales: null,
    hogs: null,
    source: 'scraped',
    error: null,
  };
}

module.exports = { parse };
