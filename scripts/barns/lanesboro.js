// scripts/barns/lanesboro.js
// Lanesboro Sales Commission — Lanesboro MN
// Parses plain HTML market reports from Webflow site.
//
// Wednesday = slaughter (Market Beef, Market Dairy, Market Cows & Bulls)
// Friday    = feeder cattle by weight class + cows/bulls
//
// HTML structure: <h5> tags with price format "LOW To HIGH" or "UP To HIGH"
// No OCR needed — all data is in the DOM as text.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { normalizePrice } = require('../scrape-barns');

// ── Helpers ──────────────────────────────────────────────────────────────────

// Extract all <h5> text nodes in order — Webflow lays out prices as
// sequences of <h5> elements: [LABEL] [LOW] [To] [HIGH] or [UP] [To] [HIGH]
function extractH5Sequence($) {
  const nodes = [];
  $('h5').each((_, el) => {
    const text = $(el).text().trim();
    if (text) nodes.push(text);
  });
  return nodes;
}

// Parse a date string like "March 25th 2026" or "Friday March 20th, 2026"
function parseReportDate(text) {
  const months = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };
  // Match: "Month DDth YYYY" or "Month DDth, YYYY"
  const m = text.match(/(\w+)\s+(\d{1,2})\w{0,2},?\s+(\d{4})/);
  if (!m) return null;
  const mm = months[m[1].toLowerCase()];
  if (!mm) return null;
  const dd = m[2].padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

// Walk <h5> sequence and build label→{low,high} map.
// Pattern: LABEL, then either [LOW] [To] [HIGH] or [UP] [To] [HIGH]
function parsePriceRows(h5s, id) {
  const rows = [];
  let i = 0;

  while (i < h5s.length) {
    const text = h5s[i];

    // Skip pure numbers / "To" / "UP" that are part of a price sequence
    if (/^\d+\.\d{2}$/.test(text) || /^to$/i.test(text) || /^up$/i.test(text)) {
      i++;
      continue;
    }

    // This looks like a label — try to read price tokens after it
    const label = text;
    let low = null, high = null;

    // Look ahead for price pattern
    const ahead = h5s.slice(i + 1, i + 5);
    // Pattern 1: [LOW] [To] [HIGH]  (e.g. "240.00" "To" "245.00")
    // Pattern 2: [UP] [To] [HIGH]   (e.g. "UP" "To" "245.00")
    // Pattern 3: [LOW] [To] [HIGH] where LOW could be "UP"

    let consumed = 0;
    if (ahead.length >= 3 && /^up$/i.test(ahead[0]) && /^to$/i.test(ahead[1]) && /^\d+\.\d{2}$/.test(ahead[2])) {
      // UP To HIGH
      high = parseFloat(ahead[2]);
      consumed = 3;
    } else if (ahead.length >= 3 && /^\d+\.\d{2}$/.test(ahead[0]) && /^to$/i.test(ahead[1]) && /^\d+\.\d{2}$/.test(ahead[2])) {
      // LOW To HIGH
      low = parseFloat(ahead[0]);
      high = parseFloat(ahead[2]);
      consumed = 3;
    } else if (ahead.length >= 1 && /^\d+\.\d{2}$/.test(ahead[0])) {
      // Single price
      high = parseFloat(ahead[0]);
      low = high;
      consumed = 1;
    }

    if (consumed > 0) {
      rows.push({ label, low, high });
      console.log(`[${id}] price row: "${label}" → ${low}–${high}`);
      i += 1 + consumed;
    } else {
      i++;
    }
  }

  return rows;
}

// Find a row by label regex match
function findRow(rows, re) {
  return rows.find(r => re.test(r.label));
}

// Convert row to {low, high} price range, validating with normalizePrice
function toRange(row) {
  if (!row) return null;
  const lo = row.low != null ? normalizePrice(row.low.toString()) : null;
  const hi = row.high != null ? normalizePrice(row.high.toString()) : null;
  if (lo == null && hi == null) return null;
  return {
    low: lo != null ? parseFloat(lo.toFixed(2)) : null,
    high: hi != null ? parseFloat(hi.toFixed(2)) : null,
  };
}

// ── Top Producers Parser (Wednesday only) ───────────────────────────────────
// Lanesboro calls their rep sales "Top Producers" — a highlight list, not
// exhaustive.  h5 sequence: [NAME:, name, DESCRIPTION:, desc, WEIGHT:, wt, PRICE:, price]
// Section headers ("Market Beef", "Market Dairy", etc.) live in <div> elements.

function parseTopProducers($, h5s, id) {
  const sales = { finished: [], cows: [], bulls: [] };

  // Walk h5 sequence for NAME: groups (8 tokens each).
  // Section headers (Market Beef/Dairy/Cows/Bulls) are in <div> elements outside
  // the h5 tree, so DOM-order tracking is unreliable in Webflow layouts.
  // Instead, classify by price + weight heuristic:
  //   Finished: price >= $200 (beef & dairy slaughter)
  //   Market cows: price < $200 AND weight >= 1800# (heavy, cheap)
  //   Market bulls: price < $200 AND weight < 1800#
  let i = 0;
  while (i < h5s.length - 7) {
    if (!/^name:$/i.test(h5s[i])) { i++; continue; }
    if (!/^description:$/i.test(h5s[i + 2])) { i++; continue; }
    if (!/^weight:$/i.test(h5s[i + 4])) { i++; continue; }
    if (!/^price:$/i.test(h5s[i + 6])) { i++; continue; }

    const name = h5s[i + 1];
    const desc = h5s[i + 3];
    const weight = parseInt(h5s[i + 5]);
    const price = parseFloat(h5s[i + 7]);
    i += 8;

    if (isNaN(price) || price < 50 || price > 500) continue;

    let cattleType = 'beef';
    const descUp = desc.toUpperCase();
    if (/HOL/i.test(descUp)) cattleType = 'holstein';
    else if (/BWF|RWF|XBRD|CROSS|DAIRY/i.test(descUp)) cattleType = 'crossbred';

    let sex = 'steer';
    if (/HFR/i.test(descUp)) sex = 'heifer';

    // Classify category by price + weight
    let category;
    if (price >= 200) {
      category = 'finished';
    } else if (!isNaN(weight) && weight >= 1800) {
      category = 'cows';
      sex = 'cow';
    } else {
      category = 'bulls';
      sex = 'bull';
    }

    sales[category].push({
      location: name, qty: 1, desc, cattleType, sex,
      weight: isNaN(weight) ? null : weight, price,
    });
  }

  console.log(`[${id}] top producers — finished: ${sales.finished.length}, cows: ${sales.cows.length}, bulls: ${sales.bulls.length}`);

  if (sales.finished.length === 0 && sales.cows.length === 0 && sales.bulls.length === 0) {
    return null;
  }

  // Build weight-class averages (same shape as central.js / rockcreek.js)
  const headCount = { finished: 0, feeder: 0, bulls: 0, cows: 0 };

  function buildWeightAvgs(entries, byType) {
    const buckets = {};
    let totalHead = 0;
    for (const s of entries) {
      totalHead += s.qty;
      if (s.weight == null) continue;
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

  console.log(`[${id}] top producer avgs — finish: ${finish.avgs.length} buckets (${headCount.finished} hd), bulls: ${bulls.avgs.length} (${headCount.bulls} hd), cows: ${cows.avgs.length} (${headCount.cows} hd)`);

  return {
    label: 'topProducers',
    finishWeightAvgs: finish.avgs,
    feederWeightAvgs: [],
    bullsWeightAvgs: bulls.avgs,
    cowsWeightAvgs: cows.avgs,
    headCount,
  };
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, browser, html, $ }) {
  const h5s = extractH5Sequence($);
  console.log(`[${id}] extracted ${h5s.length} <h5> nodes`);
  if (h5s.length < 4) {
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: 'too few h5 elements' };
  }
  console.log(`[${id}] h5 preview: ${h5s.slice(0, 20).join(' | ')}`);

  // Extract report date and head count
  let reportDate = null;
  let headCount = null;

  // Strategy 1: <p> tags with "head sold" (Wednesday post-sale report)
  $('p').each((_, el) => {
    const pText = $(el).text().trim();
    if (/\d{4}/.test(pText) && /head\s*sold/i.test(pText)) {
      const d = parseReportDate(pText);
      if (d) {
        reportDate = d;
        const hm = pText.match(/([\d,]+)\s*head/i);
        if (hm) headCount = parseInt(hm[1].replace(/,/g, ''));
        console.log(`[${id}] date from <p> (head sold): ${reportDate}, head: ${headCount}`);
      }
    }
  });

  // Strategy 2: <p> tags with a date and year (Friday or any page)
  if (!reportDate) {
    $('p').each((_, el) => {
      if (reportDate) return; // already found
      const pText = $(el).text().trim();
      if (/\d{4}/.test(pText) && pText.length < 120) {
        const d = parseReportDate(pText);
        if (d) {
          reportDate = d;
          console.log(`[${id}] date from <p> (general): ${reportDate} ("${pText.slice(0, 60)}")`);
        }
      }
    });
  }

  // Strategy 3: h5 nodes containing a date (e.g. "Wednesday Cattle Auction Report")
  if (!reportDate) {
    for (const h of h5s) {
      if (/\d{4}/.test(h)) {
        const d = parseReportDate(h);
        if (d) { reportDate = d; console.log(`[${id}] date from h5: ${reportDate}`); break; }
      }
    }
  }

  // Strategy 4: any text node with day name + date pattern
  if (!reportDate) {
    const bodyText = $.text();
    const dm = bodyText.match(/((?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?(\w+\s+\d{1,2}\w{0,2},?\s+\d{4})/i);
    if (dm) {
      const d = parseReportDate(dm[2] || dm[0]);
      if (d) { reportDate = d; console.log(`[${id}] date from body text: ${reportDate}`); }
    }
  }

  console.log(`[${id}] reportDate: ${reportDate}`);

  // Parse all price rows from h5 sequence
  const rows = parsePriceRows(h5s, id);

  // Detect page type from actual content (nav text and canonical URL are unreliable)
  // Wednesday = slaughter labels like "HIGH CHOICE BEEF"
  // Friday    = weight-class labels like "300-500LB BEEF STEERS"
  const hasSlaughterLabels = rows.some(r => /choice\s*(beef|all\s*natural|calf\s*fed|holstein)/i.test(r.label));
  const hasWeightLabels = rows.some(r => /\d{3}\s*-\s*\d{3,4}\s*LB/i.test(r.label));
  const isWednesday = hasSlaughterLabels && !hasWeightLabels;
  const isFriday = hasWeightLabels;
  console.log(`[${id}] page type (content-based): wednesday=${isWednesday}, friday=${isFriday} (slaughterLabels=${hasSlaughterLabels}, weightLabels=${hasWeightLabels})`);

  // Determine sale day
  let saleDay = null;
  if (isWednesday) saleDay = 'Wednesday';
  else if (isFriday) saleDay = 'Friday';

  const slaughter = { beef: null, crossbred: null, holstein: null };
  const feeder = { beef: null, crossbred: null, holstein: null, liteTest: false };
  const feederWeights = [];

  if (isWednesday) {
    // ── Wednesday: Slaughter prices ──────────────────────────────────────
    // HIGH CHOICE ALL NATURAL → top of beef range
    // HIGH CHOICE BEEF STRS & HFRS → beef high
    // CHOICE BEEF → beef mid
    // SELECT & CHOICE BEEF → beef low
    const hiChoiceNat = findRow(rows, /high\s*choice\s*all\s*natural/i);
    const hiChoiceBeef = findRow(rows, /high\s*choice\s*beef/i);
    const choiceBeef = findRow(rows, /^choice\s*beef/i);
    const selChoiceBeef = findRow(rows, /select\s*[&]\s*choice\s*beef/i);

    // Build beef slaughter range from lowest select to highest choice
    const beefPrices = [hiChoiceNat, hiChoiceBeef, choiceBeef, selChoiceBeef]
      .filter(Boolean)
      .flatMap(r => [r.low, r.high].filter(v => v != null));
    if (beefPrices.length > 0) {
      slaughter.beef = {
        low: parseFloat(Math.min(...beefPrices).toFixed(2)),
        high: parseFloat(Math.max(...beefPrices).toFixed(2)),
      };
      console.log(`[${id}] slaughter.beef = ${JSON.stringify(slaughter.beef)}`);
    }

    // Holstein / dairy
    const hiChoiceDairy = findRow(rows, /high\s*choice\s*calf\s*fed/i);
    const choiceDairy = findRow(rows, /^choice$/i) || findRow(rows, /^choice\s*(?!beef)/i);
    const selChoiceDairy = findRow(rows, /select\s*[&]\s*choice\s*(?!beef)/i);

    // Try specific dairy matches first
    let dairyRows = [hiChoiceDairy];
    // "CHOICE" without "BEEF" after the beef rows
    if (choiceDairy && !/beef/i.test(choiceDairy.label)) dairyRows.push(choiceDairy);
    if (selChoiceDairy && !/beef/i.test(selChoiceDairy.label)) dairyRows.push(selChoiceDairy);

    // Also look for explicit "HIGH CHOICE" / "CHOICE" / "SELECT & CHOICE" in dairy section
    const hiChoiceCalfFed = findRow(rows, /high\s*choice\s*calf/i);
    if (hiChoiceCalfFed) dairyRows.push(hiChoiceCalfFed);

    const dairyPrices = dairyRows
      .filter(Boolean)
      .flatMap(r => [r.low, r.high].filter(v => v != null));
    if (dairyPrices.length > 0) {
      slaughter.holstein = {
        low: parseFloat(Math.min(...dairyPrices).toFixed(2)),
        high: parseFloat(Math.max(...dairyPrices).toFixed(2)),
      };
      console.log(`[${id}] slaughter.holstein = ${JSON.stringify(slaughter.holstein)}`);
    }

  } else if (isFriday) {
    // ── Friday: Feeder prices ────────────────────────────────────────────
    // Weight-class rows like "300-500LB BEEF STEERS", "500-700LB BEEF HEIFERS"
    // Also has dairy steers by weight
    for (const row of rows) {
      const wm = row.label.match(/(\d{3})\s*-\s*(\d{3,4})\s*LB/i);
      if (!wm) continue;

      const wLow = parseInt(wm[1]);
      const wHigh = parseInt(wm[2]);
      const range = `${wLow}–${wHigh}#`;
      const label = row.label.toUpperCase();

      let types;
      if (/HOLSTEIN/i.test(label)) {
        types = ['holstein'];
      } else if (/BEEF\s*ON\s*DAIRY|DAIRY[\s-]*X/i.test(label)) {
        types = ['crossbred'];
      } else {
        types = ['beef'];
      }

      let sex = 'steer';
      if (/HEIFER/i.test(label)) sex = 'heifer';

      const lo = row.low != null ? parseFloat(row.low.toFixed(2)) : null;
      const hi = row.high != null ? parseFloat(row.high.toFixed(2)) : null;

      if (hi != null) {
        feederWeights.push({ range, low: lo, price: hi, types, sex });
        console.log(`[${id}] feederWeight: ${range} ${types[0]} ${sex} → ${lo}–${hi}`);
      }
    }

    // Aggregate feeder prices from weight classes
    const beefWeights = feederWeights.filter(w => w.types.includes('beef'));
    const holWeights = feederWeights.filter(w => w.types.includes('holstein'));
    const xbredWeights = feederWeights.filter(w => w.types.includes('crossbred'));

    if (beefWeights.length > 0) {
      const lows = beefWeights.map(w => w.low).filter(v => v != null);
      const highs = beefWeights.map(w => w.price).filter(v => v != null);
      feeder.beef = {
        low: lows.length > 0 ? Math.min(...lows) : null,
        high: Math.max(...highs),
      };
      console.log(`[${id}] feeder.beef = ${JSON.stringify(feeder.beef)}`);
    }

    if (holWeights.length > 0) {
      const lows = holWeights.map(w => w.low).filter(v => v != null);
      const highs = holWeights.map(w => w.price).filter(v => v != null);
      feeder.holstein = {
        low: lows.length > 0 ? Math.min(...lows) : null,
        high: Math.max(...highs),
      };
      console.log(`[${id}] feeder.holstein = ${JSON.stringify(feeder.holstein)}`);
    }

    if (xbredWeights.length > 0) {
      const lows = xbredWeights.map(w => w.low).filter(v => v != null);
      const highs = xbredWeights.map(w => w.price).filter(v => v != null);
      feeder.crossbred = {
        low: lows.length > 0 ? Math.min(...lows) : null,
        high: Math.max(...highs),
      };
      console.log(`[${id}] feeder.crossbred = ${JSON.stringify(feeder.crossbred)}`);
    }

    // Market cows & bulls from Friday page
    const cowRow = findRow(rows, /market\s*cows/i) || findRow(rows, /beef\s*cow/i);
    const bullRow = findRow(rows, /market\s*bulls/i) || findRow(rows, /bulls/i);
    console.log(`[${id}] friday cows: ${JSON.stringify(cowRow)}, bulls: ${JSON.stringify(bullRow)}`);
  }

  const hasSlaughter = Object.values(slaughter).some(v => v !== null);
  const hasFeeder = feeder.beef !== null || feeder.holstein !== null;
  console.log(`[${id}] parse — hasSlaughter=${hasSlaughter} hasFeeder=${hasFeeder}`);

  if (!hasSlaughter && !hasFeeder) {
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: 'no usable prices parsed from HTML' };
  }

  // Parse Top Producers from Wednesday page (Friday is consignment listings, no prices)
  let repSales = null;
  if (isWednesday) {
    repSales = parseTopProducers($, h5s, id);
  }

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
