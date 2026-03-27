// scripts/barns/sleepyeye.js
// Sleepy Eye Auction Market — Sleepy Eye MN
// Parses market reports from a published Google Sheet embedded via iframe.
//
// The WordPress page embeds a Google Sheets pubhtml via Advanced iFrame plugin.
// Each sheet tab is a sale report named by date (e.g. "March 3, 2026").
// Tab names don't always match the report date inside the sheet.
//
// Strategy:
//   1. Discover all sheet tabs (name + gid) from the pubhtml page
//   2. Check existing history for captured gids and report dates
//   3. Fetch CSV only for tabs we haven't seen (by gid or report date)
//   4. Return batch entries for all new tabs (like Rock Creek's PDF batch)
//
// CSV layout (merged cells create empty columns):
//   Col A: category header ("CATTLE - Fats") or description ("Blk Fats")
//   Col C: Head count
//   Col E: Avg_Wt
//   Col H: $/CWT
//   Col K: $/Head
//
// Category mapping:
//   Slaughter (beef):     Fats, FatHfr          (Blk/Red/Color descriptions)
//   Slaughter (holstein): FatStr                 (Hol/BrnSws descriptions)
//   Slaughter (beef+hol): FatStr                 (Blk/Red descriptions → beef)
//   Feeder:               FSt-Hf, FStr, FHfr, Feeder Bull (lighter cattle)
//   Skipped:              BrCow, Bull, BullClf, BC-HC, SLCow (cull/breeding)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const ROOT       = path.join(__dirname, '..', '..');
const PRICES_DIR = path.join(ROOT, 'data', 'prices');

// Google Sheets published spreadsheet base URL
const SHEETS_BASE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR21gPJvWlLmM010wpiEW3Q1XSr_Sel4aguwc3oadClksTc8BEoqktTIQIms5MW2XeVpzNsNVOPQyeI/pub';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// ── Sheet tab discovery ─────────────────────────────────────────────────────
// The pubhtml page JS contains tab metadata: name + gid.
// Tab names are dates like "March 3, 2026" but may not match report content.

function discoverSheets(html, id) {
  const tabs = [];
  const re = /name:\s*"([^"]+)"[^}]*?gid:\s*"(\d+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1];
    const gid = m[2];
    const dm = name.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (dm) {
      const month = MONTHS[dm[1].toLowerCase()];
      if (month) {
        const day = parseInt(dm[2]);
        const year = parseInt(dm[3]);
        const tabDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        tabs.push({ name, gid, tabDate });
      }
    }
    console.log(`[${id}] sheet tab: "${name}" → gid=${gid}`);
  }
  return tabs;
}

// ── Select which tabs to process ────────────────────────────────────────────
// Skip tabs whose gid we've already captured OR whose report date we already have.

function selectNewTabs(tabs, id) {
  let existingGids = new Set();
  let existingDates = new Set();

  try {
    const histPath = path.join(PRICES_DIR, `${id}.json`);
    const data = JSON.parse(fs.readFileSync(histPath, 'utf8'));
    const scraped = (data.history || []).filter(e => e.source === 'scraped');
    for (const e of scraped) {
      if (e.sheetGid) existingGids.add(e.sheetGid);
      if (e.date) existingDates.add(e.date);
    }
  } catch (e) { /* no history file */ }

  const selected = [];
  for (const tab of tabs) {
    if (existingGids.has(tab.gid)) {
      console.log(`[${id}] skip tab "${tab.name}" — gid ${tab.gid} already captured`);
      continue;
    }
    // Can't check report date yet (need to fetch CSV first) — will check after parse
    selected.push(tab);
  }

  console.log(`[${id}] ${selected.length} of ${tabs.length} tabs to process (${existingGids.size} gids, ${existingDates.size} dates in history)`);
  return { selected, existingDates };
}

// ── Category classification ─────────────────────────────────────────────────

function classifyCategory(cat) {
  if (/^(Fats|FatHfr|FatStr)$/i.test(cat)) return 'slaughter';
  if (/^(FSt-Hf|FStr|FHfr|Fdr|Feeder|StrClf|HfrClf)/i.test(cat)) return 'feeder';
  if (/^Feeder\s+Bull/i.test(cat)) return 'feeder';
  return 'skip';
}

// Breed from description prefix
function breedFromDesc(desc) {
  if (/^Hol/i.test(desc))    return 'holstein';
  if (/^BrnSws/i.test(desc)) return 'holstein';
  if (/^Jers/i.test(desc))   return 'holstein';
  return 'beef';
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

// ── Parse one sheet's CSV into a result entry ───────────────────────────────

function parseCsvData(csvText, id, tab) {
  const rows = csvText.split('\n').map(parseCsvLine);
  console.log(`[${id}] parsed ${rows.length} CSV rows for tab "${tab.name}"`);

  // Extract report date (M/D/YYYY in first few rows)
  let reportDate = null;
  for (const row of rows.slice(0, 5)) {
    const text = row.join(' ');
    const dm = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dm) {
      const mm = dm[1].padStart(2, '0');
      const dd = dm[2].padStart(2, '0');
      reportDate = `${dm[3]}-${mm}-${dd}`;
      console.log(`[${id}] report date: ${reportDate} (tab name: "${tab.name}")`);
      break;
    }
  }

  // Walk rows, detect categories, collect entries
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

    const catMatch = col0.match(/^CATTLE\s*[-–—]\s*(.+)/i);
    if (catMatch) {
      currentCat = catMatch[1].trim();
      currentClass = classifyCategory(currentCat);
      console.log(`[${id}] category: ${currentCat} → ${currentClass}`);
      continue;
    }

    if (!currentCat || currentClass === 'skip') continue;
    if (/^Descr|^Market Report|^$/i.test(col0)) continue;

    const desc = col0;
    const nums = [];
    for (let i = 1; i < fields.length && i < 12; i++) {
      const v = fields[i].replace(/[$,]/g, '').trim();
      if (v && /^\d+\.?\d*$/.test(v)) nums.push(parseFloat(v));
    }
    if (nums.length < 3) continue;

    const head = Math.round(nums[0]);
    const avgWt = Math.round(nums[1]);
    const priceCwt = nums[2];

    if (head < 1 || head > 500) continue;
    if (avgWt < 50 || avgWt > 3000) continue;
    if (priceCwt < 10 || priceCwt > 2000) continue;
    if (priceCwt > 500 && currentClass === 'slaughter') continue;

    const breed = breedFromDesc(desc);
    console.log(`[${id}]   ${desc} | ${head}hd | ${avgWt}# | $${priceCwt}/cwt [${breed}] → ${currentClass}`);

    if (currentClass === 'slaughter') {
      if (breed === 'holstein') slaughterHolstein.push({ desc, head, avgWt, priceCwt });
      else slaughterBeef.push({ desc, head, avgWt, priceCwt });
    } else if (currentClass === 'feeder') {
      feederEntries.push({ desc, head, avgWt, priceCwt, breed });
    }
  }

  // Build slaughter ranges
  if (slaughterBeef.length > 0) {
    const prices = slaughterBeef.map(e => e.priceCwt);
    slaughter.beef = { low: parseFloat(Math.min(...prices).toFixed(2)), high: parseFloat(Math.max(...prices).toFixed(2)) };
    console.log(`[${id}] slaughter.beef = ${JSON.stringify(slaughter.beef)} (${slaughterBeef.length} rows)`);
  }
  if (slaughterHolstein.length > 0) {
    const prices = slaughterHolstein.map(e => e.priceCwt);
    slaughter.holstein = { low: parseFloat(Math.min(...prices).toFixed(2)), high: parseFloat(Math.max(...prices).toFixed(2)) };
    console.log(`[${id}] slaughter.holstein = ${JSON.stringify(slaughter.holstein)} (${slaughterHolstein.length} rows)`);
  }

  // Build feeder ranges and weight buckets — split by breed
  const feederBeefEntries = feederEntries.filter(e => e.breed !== 'holstein');
  const feederHolEntries  = feederEntries.filter(e => e.breed === 'holstein');

  if (feederBeefEntries.length > 0) {
    const prices = feederBeefEntries.map(e => e.priceCwt);
    feeder.beef = { low: parseFloat(Math.min(...prices).toFixed(2)), high: parseFloat(Math.max(...prices).toFixed(2)) };
    console.log(`[${id}] feeder.beef = ${JSON.stringify(feeder.beef)} (${feederBeefEntries.length} rows)`);
  }
  if (feederHolEntries.length > 0) {
    const prices = feederHolEntries.map(e => e.priceCwt);
    feeder.holstein = { low: parseFloat(Math.min(...prices).toFixed(2)), high: parseFloat(Math.max(...prices).toFixed(2)) };
    console.log(`[${id}] feeder.holstein = ${JSON.stringify(feeder.holstein)} (${feederHolEntries.length} rows)`);
  }

  if (feederEntries.length > 0) {
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

  // Build repSales
  const repSales = buildRepSales(slaughterBeef, slaughterHolstein, feederEntries, id);

  const hasSlaughter = slaughter.beef !== null || slaughter.holstein !== null;
  const hasFeeder = feeder.beef !== null || feeder.holstein !== null;

  let saleDay = null;
  if (reportDate) {
    const d = new Date(reportDate + 'T12:00:00');
    saleDay = DAYS[d.getDay()];
  }

  console.log(`[${id}] ✓ tab "${tab.name}" → date=${reportDate}, day=${saleDay}, slaughter=${hasSlaughter}, feeder=${hasFeeder}`);

  return {
    slaughter: hasSlaughter ? slaughter : null,
    feeder: hasFeeder ? feeder : null,
    feederWeights,
    reportDate,
    saleDay,
    liteTestNote: null,
    repSales,
    hogs: null,
    sheetGid: tab.gid,
    source: (hasSlaughter || hasFeeder) ? 'scraped' : 'fetch_failed',
    error: (!hasSlaughter && !hasFeeder) ? 'no prices found in CSV data' : null,
  };
}

// ── Build repSales from individual sale entries ─────────────────────────────

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
  // 1. Discover all sheet tabs from the pubhtml page
  const tabs = discoverSheets(html || '', id);
  if (tabs.length === 0) {
    console.log(`[${id}] no sheet tabs discovered — fetching default CSV`);
    const csvUrl = SHEETS_BASE + '?output=csv';
    let csvText;
    try { csvText = await fetchCsv(csvUrl, id); }
    catch (err) {
      return { slaughter: null, feeder: null, source: 'fetch_failed', error: err.message };
    }
    return parseCsvData(csvText, id, { name: 'default', gid: '0', tabDate: null });
  }

  // 2. Filter to tabs we haven't captured (by gid); track existing report dates
  const { selected, existingDates } = selectNewTabs(tabs, id);

  if (selected.length === 0) {
    console.log(`[${id}] all tabs already captured — nothing new`);
    return {
      slaughter: null, feeder: null,
      reportDate: tabs[0].tabDate,
      source: 'scraped',
      error: null,
    };
  }

  // 3. Process each new tab (oldest tabDate first for chronological history)
  const sorted = [...selected].sort((a, b) => (a.tabDate || '').localeCompare(b.tabDate || ''));
  const batchEntries = [];

  for (const tab of sorted) {
    console.log(`\n[${id}] ▸ processing tab: "${tab.name}" gid=${tab.gid}`);

    let csvText;
    try {
      csvText = await fetchCsv(`${SHEETS_BASE}?output=csv&gid=${tab.gid}`, id);
    } catch (err) {
      console.error(`[${id}] tab "${tab.name}" CSV fetch failed: ${err.message}`);
      continue;
    }

    const result = parseCsvData(csvText, id, tab);

    // Dedup by report date — skip if we already have this date (handles renamed tabs)
    if (result.reportDate && existingDates.has(result.reportDate)) {
      console.log(`[${id}] skip tab "${tab.name}" — report date ${result.reportDate} already in history`);
      continue;
    }

    if (result.source !== 'scraped') {
      console.log(`[${id}] tab "${tab.name}" produced no data — skipping`);
      continue;
    }

    batchEntries.push(result);
  }

  if (batchEntries.length === 0) {
    return {
      slaughter: null, feeder: null,
      reportDate: tabs[0].tabDate,
      source: 'scraped',
      error: null,
    };
  }

  console.log(`[${id}] batch complete — ${batchEntries.length} new entries`);

  // Return newest as main result; older entries in _batchEntries for orchestrator
  const newest = batchEntries[batchEntries.length - 1];
  newest._batchEntries = batchEntries.slice(0, -1);
  return newest;
}

module.exports = { parse };
