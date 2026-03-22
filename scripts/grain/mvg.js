// scripts/grain/mvg.js
// Minnesota Valley Grain — cash bid scraper
// Parses the Barchart-style cash bid table on mnvalleygrain.com.
// All locations show on a single page with location name as a header row.
// Columns: Name, Delivery, Delivery End, Futures Month, Futures Price, Change, Basis, $ Price, Settlement
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
  // Basis on this site is in cents (e.g. -63 means -$0.63)
  const cleaned = str.replace(/[^0-9.\-]/g, '');
  const val = parseInt(cleaned, 10);
  return isNaN(val) ? null : val / 100;
}

// Convert delivery date range to a short label like "Mar26"
function deliveryLabel(startStr) {
  if (!startStr) return null;
  const m = startStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = parseInt(m[1], 10) - 1;
    const yr = m[3].slice(2);
    return months[mon] + yr;
  }
  // Try ISO format
  const iso = startStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = parseInt(iso[2], 10) - 1;
    const yr = iso[1].slice(2);
    return months[mon] + yr;
  }
  return startStr;
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
    await new Promise(r => setTimeout(r, 2000));

    const html = await page.content();
    console.log(`[${id}] page loaded · ${html.length} bytes`);

    const $ = cheerio.load(html);

    // The page structure: location name appears as a standalone text/header,
    // followed by a table with rows for each commodity bid.
    // We look for rows in the main table and track location context.

    let currentLocation = null;
    let currentSlug = null;

    // Find all table rows in the cash bid area
    const rows = $('table tr, .market-table tr').toArray();

    // If no standard table rows, try parsing the page text structure
    if (rows.length === 0) {
      console.warn(`[${id}] no table rows found — page structure may differ`);
      return { locations: {}, source: 'fetch_failed', error: 'no table rows found' };
    }

    for (const row of rows) {
      const $row = $(row);
      const cells = $row.find('td, th').toArray();
      const rowText = $row.text().trim();

      // Detect location header — a row or text block with just a location name
      // Location names from config
      const configLocs = (config.locations || []).map(l => l.name.toLowerCase());

      // Check if this is a location header (single cell or standalone text matching a known location)
      if (cells.length <= 2 && configLocs.some(l => rowText.toLowerCase().includes(l))) {
        const matched = config.locations.find(l =>
          rowText.toLowerCase().includes(l.name.toLowerCase())
        );
        if (matched) {
          currentLocation = matched.name;
          currentSlug = slugify(currentLocation);
          if (!locations[currentSlug]) {
            locations[currentSlug] = { name: currentLocation, corn: [], beans: [] };
          }
          console.log(`[${id}] found location header: "${currentLocation}"`);
          continue;
        }
      }

      // Also check: sometimes location appears as a standalone element before the table
      // Try detecting from page structure
      if (!currentLocation && cells.length <= 2) {
        // Check all configured locations
        for (const loc of config.locations || []) {
          if (rowText.toLowerCase() === loc.name.toLowerCase()) {
            currentLocation = loc.name;
            currentSlug = slugify(currentLocation);
            if (!locations[currentSlug]) {
              locations[currentSlug] = { name: currentLocation, corn: [], beans: [] };
            }
            console.log(`[${id}] found location header: "${currentLocation}"`);
            break;
          }
        }
        if (!currentLocation) continue;
      }

      // Skip header rows
      if (/^name/i.test(rowText) || /delivery\s+end/i.test(rowText)) continue;

      // Parse data rows — need at least 7 cells
      if (!currentLocation || cells.length < 7) continue;

      const name     = $(cells[0]).text().trim().toUpperCase();
      const delStart = $(cells[1]).text().trim();
      const futMonth = $(cells[3]).text().trim();
      const futPrice = $(cells[4]).text().trim();
      const change   = $(cells[5]).text().trim();
      const basis    = $(cells[6]).text().trim();
      const price    = cells.length > 7 ? $(cells[7]).text().trim() : null;

      // Classify commodity
      let commodity = null;
      if (/CORN/i.test(name)) commodity = 'corn';
      else if (/SOY|BEAN/i.test(name)) commodity = 'beans';

      if (!commodity) continue;

      const delivery = deliveryLabel(delStart);
      if (!delivery) continue;

      const entry = {
        delivery,
        cash:         parseCash(price),
        futuresMonth: futMonth || null,
        basis:        parseBasis(basis),
        change:       change || null,
        cbot:         futPrice || null,
      };

      if (entry.cash !== null) {
        locations[currentSlug][commodity].push(entry);
      }
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
