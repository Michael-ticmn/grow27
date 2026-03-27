// scripts/barns/sleepyeye.js
// Sleepy Eye Auction Market — Sleepy Eye MN
// Parses market reports from a published Google Sheet embedded via iframe.
//
// The WordPress page embeds a Google Sheets pubhtml via Advanced iFrame plugin.
// Rather than parsing the JS-rendered HTML, we extract the spreadsheet URL from
// the iframe src and fetch the CSV export directly — much more reliable.
//
// Google Sheets CSV export: append ?output=csv&gid=N for specific sheets.
// Sheet tabs are named by date (e.g. "March 3, 2026"). The parser discovers
// all tabs from the pubhtml page, picks the most recent by date, and fetches
// that tab's CSV.
//
// CSV layout (merged cells create empty columns):
//   Col A: category header ("CATTLE - Fats") or description ("Blk Fats")
//   Col C: Head count
//   Col E: Avg_Wt
//   Col H: $/CWT
//   Col K: $/Head
//   (Also: Hay Results in cols M-N, which we skip)
//
// Category mapping:
//   Slaughter (beef):     Fats, FatHfr          (Blk/Red/Color descriptions)
//   Slaughter (holstein): FatStr                 (Hol/BrnSws descriptions)
//   Slaughter (beef+hol): FatStr                 (Blk/Red descriptions → beef)
//   Feeder:               FSt-Hf, FStr, FHfr    (lighter cattle)
//   Skipped:              BrCow, Bull, BullClf, BC-HC, SLCow (cull/breeding)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const https = require('https');
const http  = require('http');

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Google Sheets published spreadsheet base URL
const SHEETS_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR21gPJvWlLmM010wpiEW3Q1XSr_Sel4aguwc3oadClksTc8BEoqktTIQIms5MW2XeVpzNsNVOPQyeI/pub';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// ── Sheet tab discovery ─────────────────────────────────────────────────────
// The pubhtml page contains JS with sheet tab names and gids.
// Tab names are dates like "March 3, 2026". We parse them, pick the most
// recent, and fetch that tab's CSV via &gid=N.

function discoverSheets(html, id) {
  // Pattern: name: "March 3, 2026" ... gid: "2019930084"
  const tabs = [];
  const re = /name:\s*"([^"]+)"[^}]*?gid:\s*"(\d+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1];
    const gid = m[2];
    // Parse "Month D, YYYY" → Date
    const dm = name.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (dm) {
      const month = MONTHS[dm[1].toLowerCase()];
      if (month) {
        const day = parseInt(dm[2]);
        const year = parseInt(dm[3]);
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        tabs.push({ name, gid, dateStr });
      }
    }
    console.log(`[${id}] sheet tab: "${name}" → gid=${gid}`);
  }
  return tabs.sort((a, b) => b.dateStr.localeCompare(a.dateStr)); // newest first
}

// ── Category classification ─────────────────────────────────────────────────

function classifyCategory(cat) {
  if (/^(Fats|FatHfr|FatStr)$/i.test(cat)) return 'slaughter';
  if (/^(FSt-Hf|FStr|FHfr|Fdr|Feeder|StrClf|HfrClf)/i.test(cat)) return 'feeder';
  return 'skip';  // BrCow, Bull, BullClf, BC-HC, SLCow, Hay, etc.
}

// Breed from description prefix
function breedFromDesc(desc) {
  if (/^Hol/i.test(desc))    return 'holstein';
  if (/^BrnSws/i.test(desc)) return 'holstein';  // Brown Swiss → dairy
  if (/^Jers/i.test(desc))   return 'holstein';  // Jersey → dairy
  return 'beef';  // Blk, Red, Color, Bwf, Rwf → beef/crossbred
}

// ── Fetch CSV via HTTPS (follows redirects) ─────────────────────────────────

function fetchCsv(url, id, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('too many redirects'));
        console.log(`[${id}] CSV redirect → ${res.headers.location}`);
        return fetchCsv(res.headers.location, id, maxRedirects - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        console.log(`[${id}] CSV fetched — ${text.length} chars`);
        resolve(text);
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Parse CSV text ──────────────────────────────────────────────────────────

function parseCsvLine(line) {
  // Handle quoted fields with commas inside
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ── Build repSales from individual sale entries ─────────────────────────────
// Groups entries into 100-lb weight buckets with weighted-average prices,
// matching the shape used by Central/Rock Creek so the PWA can show
// "barn reported" per weight class instead of estimates.

function buildRepSales(beefEntries, holsteinEntries, feederEntries, id) {
  function bucketAvgs(entries, byType) {
    const buckets = {};
    let totalHead = 0;
    for (const e of entries) {
      totalHead += e.head;
      const bucket = Math.floor(e.avgWt / 100) * 100;
      const range = `${bucket}-${bucket + 99}`;
      const type = e.breed || (byType ? 'beef' : undefined);
      const key = byType ? `${range}|${type}` : range;
      if (!buckets[key]) buckets[key] = { range, type, sum: 0, count: 0 };
      buckets[key].sum += e.priceCwt * e.head;
      buckets[key].count += e.head;
    }
    const avgs = Object.values(buckets).map(b => ({
      range: b.range + ' lbs',
      ...(byType && b.type ? { type: b.type } : {}),
      avgPrice: parseFloat((b.sum / b.count).toFixed(2)),
      head: b.count,
    })).sort((a, b) => parseInt(a.range) - parseInt(b.range));
    return { avgs, totalHead };
  }

  const allFinished = [
    ...beefEntries.map(e => ({ ...e, breed: 'beef' })),
    ...holsteinEntries.map(e => ({ ...e, breed: 'holstein' })),
  ];
  const finish = bucketAvgs(allFinished, true);
  const feeder = bucketAvgs(feederEntries, true);

  console.log(`[${id}] repSales — finish: ${finish.avgs.length} buckets (${finish.totalHead} hd), feeder: ${feeder.avgs.length} buckets (${feeder.totalHead} hd)`);

  if (finish.totalHead === 0 && feeder.totalHead === 0) return null;

  return {
    finishWeightAvgs: finish.avgs,
    feederWeightAvgs: feeder.avgs,
    bullsWeightAvgs: [],
    cowsWeightAvgs: [],
    headCount: {
      finished: finish.totalHead,
      feeder: feeder.totalHead,
      bulls: 0,
      cows: 0,
    },
  };
}

// ── Main parse function ─────────────────────────────────────────────────────

async function parse({ id, browser, html }) {
  // Step 1: Discover sheet tabs from the pubhtml page (passed by orchestrator).
  // Pick the most recent tab by date, then fetch its CSV via &gid=N.
  const tabs = discoverSheets(html || '', id);
  let csvUrl = SHEETS_BASE + '?output=csv';  // default: first sheet

  if (tabs.length > 0) {
    const newest = tabs[0];
    csvUrl = `${SHEETS_BASE}?output=csv&gid=${newest.gid}`;
    console.log(`[${id}] selected newest tab: "${newest.name}" (${newest.dateStr}) gid=${newest.gid}`);
  } else {
    console.log(`[${id}] no tabs discovered — using default (first sheet)`);
  }

  let csvText;
  try {
    csvText = await fetchCsv(csvUrl, id);
  } catch (err) {
    console.error(`[${id}] CSV fetch failed: ${err.message}`);
    return {
      slaughter: null, feeder: null,
      source: 'fetch_failed',
      error: `CSV fetch failed: ${err.message}`,
    };
  }

  // Step 2: Parse CSV rows
  const rows = csvText.split('\n').map(parseCsvLine);
  console.log(`[${id}] parsed ${rows.length} CSV rows`);

  // Step 3: Extract report date (M/D/YYYY in first few rows)
  let reportDate = null;
  for (const row of rows.slice(0, 5)) {
    const text = row.join(' ');
    const dm = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dm) {
      const mm = dm[1].padStart(2, '0');
      const dd = dm[2].padStart(2, '0');
      reportDate = `${dm[3]}-${mm}-${dd}`;
      console.log(`[${id}] report date: ${reportDate}`);
      break;
    }
  }

  // Step 4: Walk rows, detect category headers, collect price entries
  const slaughter = { beef: null, crossbred: null, holstein: null };
  const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };
  const feederWeights = [];

  const slaughterBeef = [];
  const slaughterHolstein = [];
  const feederEntries = [];

  let currentCat = null;
  let currentClass = null;

  for (const fields of rows) {
    const col0 = fields[0] || '';

    // Detect category header: "CATTLE - Fats" in column A
    const catMatch = col0.match(/^CATTLE\s*[-–—]\s*(.+)/i);
    if (catMatch) {
      currentCat = catMatch[1].trim();
      currentClass = classifyCategory(currentCat);
      console.log(`[${id}] category: ${currentCat} → ${currentClass}`);
      continue;
    }

    // Skip header rows and non-data
    if (!currentCat || currentClass === 'skip') continue;
    if (/^Descr|^Market Report|^$/i.test(col0)) continue;

    // CSV columns (Google Sheets merged cells = empty columns between):
    //   [0]=Descr  [1]='' [2]=Head [3]='' [4]=Avg_Wt [5]='' [6]='' [7]=$/CWT [8]='' [9]='' [10]=$/Head
    // But actual positions vary — find the numeric values
    const desc = col0;

    // Extract head count, avg weight, $/CWT from the row
    // Find all numeric-looking values in the row
    const nums = [];
    for (let i = 1; i < fields.length && i < 12; i++) {
      const v = fields[i].replace(/[$,]/g, '').trim();
      if (v && /^\d+\.?\d*$/.test(v)) nums.push(parseFloat(v));
    }

    if (nums.length < 3) continue;

    // Pattern: head, avgWt, $/CWT, $/Head
    const head = Math.round(nums[0]);
    const avgWt = Math.round(nums[1]);
    const priceCwt = nums[2];

    // Sanity checks
    if (head < 1 || head > 500) continue;
    if (avgWt < 50 || avgWt > 3000) continue;
    if (priceCwt < 10 || priceCwt > 2000) continue;

    // Baby calves have very high $/CWT (e.g. 1880 for 63# calves) — that's $/head really
    // Skip entries with $/CWT > 500 unless it's explicitly a feeder category
    if (priceCwt > 500 && currentClass === 'slaughter') continue;

    const breed = breedFromDesc(desc);
    console.log(`[${id}]   ${desc} | ${head}hd | ${avgWt}# | $${priceCwt}/cwt [${breed}] → ${currentClass}`);

    if (currentClass === 'slaughter') {
      if (breed === 'holstein') {
        slaughterHolstein.push({ desc, head, avgWt, priceCwt });
      } else {
        slaughterBeef.push({ desc, head, avgWt, priceCwt });
      }
    } else if (currentClass === 'feeder') {
      feederEntries.push({ desc, head, avgWt, priceCwt, breed });
    }
  }

  // ── Build slaughter ranges ────────────────────────────────────────────────
  if (slaughterBeef.length > 0) {
    const prices = slaughterBeef.map(e => e.priceCwt);
    slaughter.beef = {
      low:  parseFloat(Math.min(...prices).toFixed(2)),
      high: parseFloat(Math.max(...prices).toFixed(2)),
    };
    console.log(`[${id}] slaughter.beef = ${JSON.stringify(slaughter.beef)} (${slaughterBeef.length} rows)`);
  }
  if (slaughterHolstein.length > 0) {
    const prices = slaughterHolstein.map(e => e.priceCwt);
    slaughter.holstein = {
      low:  parseFloat(Math.min(...prices).toFixed(2)),
      high: parseFloat(Math.max(...prices).toFixed(2)),
    };
    console.log(`[${id}] slaughter.holstein = ${JSON.stringify(slaughter.holstein)} (${slaughterHolstein.length} rows)`);
  }

  // ── Build feeder ranges and weight buckets ────────────────────────────────
  if (feederEntries.length > 0) {
    const prices = feederEntries.map(e => e.priceCwt);
    feeder.beef = {
      low:  parseFloat(Math.min(...prices).toFixed(2)),
      high: parseFloat(Math.max(...prices).toFixed(2)),
    };
    console.log(`[${id}] feeder.beef = ${JSON.stringify(feeder.beef)} (${feederEntries.length} rows)`);

    // Group by 100-lb weight buckets
    const buckets = {};
    for (const e of feederEntries) {
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

  // ── Build repSales weight-class averages from individual entries ─────────
  // This gives the PWA actual barn-reported prices per weight class instead
  // of estimates derived from the overall range.
  const repSales = buildRepSales(slaughterBeef, slaughterHolstein, feederEntries, id);

  const hasSlaughter = slaughter.beef !== null || slaughter.holstein !== null;
  const hasFeeder = feeder.beef !== null;

  if (!hasSlaughter && !hasFeeder) {
    console.error(`[${id}] no prices extracted from CSV`);
    return {
      slaughter: null, feeder: null,
      reportDate,
      source: 'fetch_failed',
      error: 'no prices found in CSV data',
    };
  }

  // Determine sale day from report date
  let saleDay = null;
  if (reportDate) {
    const d = new Date(reportDate + 'T12:00:00');
    saleDay = DAYS[d.getDay()];
  }

  console.log(`[${id}] ✓ slaughter.beef=${JSON.stringify(slaughter.beef)}, slaughter.holstein=${JSON.stringify(slaughter.holstein)}, feeder.beef=${JSON.stringify(feeder.beef)}, date=${reportDate}, day=${saleDay}`);

  return {
    slaughter,
    feeder,
    feederWeights,
    reportDate,
    saleDay,
    liteTestNote: null,
    repSales,
    hogs: null,
    source: 'scraped',
    error: null,
  };
}

module.exports = { parse };
