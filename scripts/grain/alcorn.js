// scripts/grain/alcorn.js
// Al-Corn Clean Fuel — cash bid scraper
// Single location (Claremont MN), corn only.
// Uses a CIH (Commodity Information Hub) widget — not DTN.
// Widget structure: table.cih-table inside div.cih-loc-card containers.
// Select#cih-location-filter, select#cih-commodity-filter.
// Columns: Delivery | Futures (month+price) | Change | Basis | Bid (cash)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// Normalize delivery: "Mar 26" → "Mar26", "Mar 2026" → "Mar26"
function normDelivery(str) {
  if (!str) return null;
  const t = str.trim();
  const m1 = t.match(/^([A-Za-z]{3})\s*(\d{4})$/);
  if (m1) return m1[1] + m1[2].slice(2);
  const m2 = t.match(/^([A-Za-z]{3})\s+(\d{2})$/);
  if (m2) return m2[1] + m2[2];
  if (/^[A-Za-z]{3}\d{2}$/.test(t)) return t;
  return t;
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const url = config.url;
  const locations = {};

  console.log(`[${id}] navigating to ${url}`);
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for CIH widget to render
    await page.waitForSelector('table.cih-table', { timeout: 15000 });
    console.log(`[${id}] CIH widget found`);

    // Extra settle time
    await new Promise(r => setTimeout(r, 2000));

    // Parse all location cards with their tables
    const bidData = await page.evaluate(() => {
      const result = {};

      // Each location card wraps a commodity section with a table
      const cards = document.querySelectorAll('.cih-loc-card');
      if (cards.length === 0) {
        // Fallback: just grab all cih-tables directly
        const tables = document.querySelectorAll('table.cih-table');
        if (tables.length === 0) return null;

        // Parse first table as Al-Corn corn
        result['al-corn'] = { corn: parseTable(tables[0]) };
        return result;
      }

      for (const card of cards) {
        // Get location name from card header
        const header = card.querySelector('.cih-loc-name, h3, h4, [class*="header"], [class*="title"]');
        const locName = header ? header.textContent.trim() : null;

        // Get commodity name from card
        const commodityEl = card.querySelector('.cih-commodity-name, [class*="commodity"]');
        const commodityText = commodityEl ? commodityEl.textContent.trim().toUpperCase() : '';

        const table = card.querySelector('table.cih-table');
        if (!table) continue;

        const rows = parseTable(table);
        if (rows.length === 0) continue;

        // Use location name as key, default to card index
        const key = locName || 'unknown';
        if (!result[key]) result[key] = {};

        const commodity = commodityText.includes('SOY') ? 'beans' : 'corn';
        result[key][commodity] = rows;
      }

      return Object.keys(result).length > 0 ? result : null;

      function parseTable(table) {
        const rows = [];
        const allRows = table.querySelectorAll('tr');
        let colMap = null;

        for (const row of allRows) {
          const cells = row.querySelectorAll('td, th');
          if (cells.length < 4) continue;

          const headers = Array.from(cells).map(c => c.textContent.trim().toUpperCase());

          // Detect header row
          if (!colMap && headers.some(h => /DELIVER/i.test(h))) {
            colMap = {};
            headers.forEach((h, i) => {
              if (/DELIVER/i.test(h))             colMap.delivery = i;
              if (/^FUTURES$/i.test(h))           colMap.futures = i;
              if (/^BASIS$/i.test(h))             colMap.basis = i;
              if (/^BID$/i.test(h))               colMap.cash = i;
              if (/^CASH/i.test(h))               colMap.cash = i;
              if (/CHANGE/i.test(h))              colMap.change = i;
            });
            continue;
          }

          // Parse data rows
          if (colMap && cells.length >= 4) {
            const get = (idx) => idx != null && cells[idx] ? cells[idx].textContent.trim() : null;
            const delivery = get(colMap.delivery);

            if (delivery && /^[A-Za-z]{3}\s?\d{2}/i.test(delivery)) {
              const entry = {
                del: delivery,
                cash: get(colMap.cash),
                basis: get(colMap.basis),
              };

              // Futures column contains both month and price
              if (colMap.futures != null) {
                const futuresText = get(colMap.futures);
                if (futuresText) {
                  // "May 26" or "May26" — just the month reference
                  entry.month = futuresText;
                }
                // Check if there's a price value in the next cell (some layouts split month + price)
                const nextIdx = colMap.futures + 1;
                if (nextIdx < cells.length && colMap.change !== nextIdx && colMap.basis !== nextIdx && colMap.cash !== nextIdx) {
                  const nextVal = cells[nextIdx]?.textContent?.trim();
                  if (nextVal && /^\d+\.\d+/.test(nextVal)) {
                    entry.futuresPrice = nextVal;
                  }
                }
              }

              if (colMap.change != null) entry.chg = get(colMap.change);
              rows.push(entry);
            }
          }
        }

        return rows;
      }
    });

    if (!bidData) {
      console.warn(`[${id}] no bid data found`);
      return { locations: {}, source: 'fetch_failed', error: 'no data in CIH tables' };
    }

    console.log(`[${id}] raw locations found: ${Object.keys(bidData).join(', ')}`);

    // Process each location
    for (const [locName, commodities] of Object.entries(bidData)) {
      // Only capture Al-Corn, skip HCP
      const nameLower = locName.toLowerCase();
      if (nameLower.includes('hcp')) {
        console.log(`[${id}] skipping location: ${locName}`);
        continue;
      }

      const slug = 'claremont';
      const parsed = {};

      for (const [commodity, rows] of Object.entries(commodities)) {
        parsed[commodity] = rows.map(r => {
          const entry = {
            delivery: normDelivery(r.del),
            cash:     parseCash(r.cash),
            basis:    parseBasis(r.basis),
          };
          if (r.month) entry.futuresMonth = normDelivery(r.month);
          if (r.chg)   entry.change = r.chg;
          if (r.futuresPrice) entry.cbot = r.futuresPrice;
          return entry;
        }).filter(r => r.cash !== null);
      }

      locations[slug] = { name: 'Al-Corn', ...parsed };

      const cornCount = parsed.corn?.length || 0;
      console.log(`[${id}:${slug}] parsed — corn: ${cornCount} bids`);
      if (cornCount > 0) {
        console.log(`[${id}:${slug}]   corn nearby: $${parsed.corn[0].cash} basis ${parsed.corn[0].basis} (${parsed.corn[0].delivery})`);
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

  if (locCount === 0) {
    return { locations, source: 'fetch_failed', error: 'no Al-Corn data found' };
  }

  return { locations, source: 'scraped', error: null };
}

module.exports = { parse };
