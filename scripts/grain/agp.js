// scripts/grain/agp.js
// Ag Partners — cash bid scraper
// Parses the Barchart widget on agpartners.net/markets-cashbids/.
// Page shows all locations in a flat table grouped by commodity (Corn, Soybeans).
// Columns: Location, Delivery Label, Change, Cash Price, Basis, Symbol, Futures Price
// All data visible on one page with "All" locations selected — no dropdown interaction needed.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

let cheerio;

function slugify(name) {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function parseCash(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.\-]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function parseBasis(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.\-]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

// Convert "Apr 2026" or "Cash" to short label like "Apr26" or "Cash"
function deliveryLabel(str) {
  if (!str) return null;
  const trimmed = str.trim();
  if (/^cash$/i.test(trimmed)) return 'Cash';
  // "Apr 2026" → "Apr26"
  const m = trimmed.match(/^([A-Za-z]{3})\s*(\d{4})$/);
  if (m) return m[1] + m[2].slice(2);
  // "Apr 26" (short year)
  const m2 = trimmed.match(/^([A-Za-z]{3})\s*(\d{2})$/);
  if (m2) return m2[1] + m2[2];
  return trimmed;
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  if (!cheerio) cheerio = require('cheerio');

  const url = config.url;
  const locations = {};

  console.log(`[${id}] navigating to ${url}`);
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const html = await page.content();
    console.log(`[${id}] page loaded · ${html.length} bytes`);

    const $ = cheerio.load(html);

    // The Barchart widget renders a table grouped by commodity.
    // Commodity headers appear as standalone text (e.g. "Corn", "Soybeans")
    // followed by a header row (LOCATION, DELIVERY LABEL, CHANGE, CASH PRICE, BASIS, SYMBOL, FUTURES PRICE)
    // then data rows with location in the first column.

    let currentCommodity = null;

    // Find all table rows
    const rows = $('table tr').toArray();
    console.log(`[${id}] found ${rows.length} table rows`);

    for (const row of rows) {
      const $row = $(row);
      const cells = $row.find('td, th').toArray();
      const rowText = $row.text().trim();

      // Detect commodity headers — standalone text like "Corn" or "Soybeans"
      const upper = rowText.toUpperCase().replace(/\s+/g, ' ').trim();
      if (upper === 'CORN' || /^CORN\s*$/.test(upper)) {
        currentCommodity = 'corn';
        console.log(`[${id}] commodity section: corn`);
        continue;
      }
      if (upper === 'SOYBEANS' || upper === 'BEANS' || /^SOYBEANS\s*$/.test(upper)) {
        currentCommodity = 'beans';
        console.log(`[${id}] commodity section: beans`);
        continue;
      }

      // Skip header rows
      if (/^LOCATION/i.test(rowText)) continue;

      // Parse data rows — need at least 5 cells
      if (!currentCommodity || cells.length < 5) continue;

      const locName   = $(cells[0]).text().trim();
      const delivery  = $(cells[1]).text().trim();
      const change    = $(cells[2]).text().trim();
      const cashStr   = $(cells[3]).text().trim();
      const basisStr  = $(cells[4]).text().trim();
      const symbol    = cells.length > 5 ? $(cells[5]).text().trim() : null;
      const futPrice  = cells.length > 6 ? $(cells[6]).text().trim() : null;

      if (!locName || !delivery) continue;

      const slug = slugify(locName);
      const cash = parseCash(cashStr);
      if (cash === null) continue;

      // Initialize location if new
      if (!locations[slug]) {
        locations[slug] = { name: locName, corn: [], beans: [] };
      }

      const entry = {
        delivery:     deliveryLabel(delivery),
        cash:         cash,
        futuresMonth: symbol || null,
        basis:        parseBasis(basisStr),
        change:       change || null,
        cbot:         futPrice || null,
      };

      locations[slug][currentCommodity].push(entry);
    }
  } catch (err) {
    console.error(`[${id}] PAGE LOAD FAILED: ${err.message}`);
    return { locations: {}, source: 'fetch_failed', error: err.message };
  } finally {
    await page.close();
  }

  const locCount = Object.keys(locations).length;
  console.log(`\n[${id}] scrape complete — ${locCount} locations captured`);

  for (const [slug, data] of Object.entries(locations)) {
    console.log(`[${id}:${slug}] corn: ${data.corn.length} bids, beans: ${data.beans.length} bids`);
    if (data.corn.length > 0) {
      console.log(`[${id}:${slug}]   corn nearby: $${data.corn[0].cash} basis ${data.corn[0].basis} (${data.corn[0].delivery})`);
    }
    if (data.beans.length > 0) {
      console.log(`[${id}:${slug}]   beans nearby: $${data.beans[0].cash} basis ${data.beans[0].basis} (${data.beans[0].delivery})`);
    }
  }

  if (locCount === 0) {
    return { locations, source: 'fetch_failed', error: 'no locations scraped' };
  }

  return { locations, source: 'scraped', error: null };
}

module.exports = { parse };
