// scripts/grain/alcorn.js
// Al-Corn Clean Fuel — cash bid scraper
// Parses the DTN Cashbid widget on al-corn.com/cash-bids/
// Single location, DTN table with column order:
//   Delivery | Futures (month) | Futures (price) | Change | Basis | Bid (cash)
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

function parseCbot(str) {
  if (!str) return null;
  return str.trim() || null;
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const url = config.url;
  const locations = {};
  let lastError = null;

  console.log(`[${id}] navigating to ${url}`);
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for the DTN widget to render — try table first, then dropdown
    await page.waitForSelector('#dtn-bids, table[summary="Cash Bid Offers"], select[id*="dtnCashbidDetailLocation"]', { timeout: 15000 });
    console.log(`[${id}] page loaded, DTN widget found`);

    // Extra settle time for widget JS
    await new Promise(r => setTimeout(r, 2000));

    // Detect column order from header row, then parse all commodity sections
    const bidData = await page.evaluate(() => {
      const table = document.querySelector('#dtn-bids') ||
                    document.querySelector('table[summary="Cash Bid Offers"]');
      if (!table) return null;

      const result = {};
      let currentCommodity = null;
      let colMap = null;

      const allRows = table.querySelectorAll('tr');

      for (const row of allRows) {
        const cells = row.querySelectorAll('td, th');
        const text = row.textContent.trim().toUpperCase();

        // Detect commodity header rows
        if (text === 'CORN' || text === 'SOYBEANS' || text === 'BEANS') {
          currentCommodity = (text === 'SOYBEANS' || text === 'BEANS') ? 'beans' : 'corn';
          result[currentCommodity] = [];
          colMap = null; // reset column map for each commodity section
          continue;
        }

        // Detect column header row and build column map
        if (currentCommodity && !colMap && cells.length >= 4) {
          const headers = Array.from(cells).map(c => c.textContent.trim().toUpperCase());
          if (headers.some(h => /DELIVER/i.test(h) || /^DEL$/i.test(h))) {
            colMap = {};
            headers.forEach((h, i) => {
              if (/DELIVER/i.test(h) || /^DEL$/i.test(h)) colMap.delivery = i;
              else if (/^FUTURES$/i.test(h))               colMap.futuresMonth = i;
              else if (/^BASIS$/i.test(h))                 colMap.basis = i;
              else if (/^BID$/i.test(h) || /^CASH$/i.test(h)) colMap.cash = i;
              else if (/CHANGE/i.test(h) || /^CHG$/i.test(h)) colMap.change = i;
              else if (/^CBOT$/i.test(h))                  colMap.cbot = i;
            });
            continue;
          }
        }

        // Parse data rows
        if (currentCommodity && colMap && cells.length >= 4) {
          const get = (idx) => idx != null && cells[idx] ? cells[idx].textContent.trim() : null;

          const delivery = get(colMap.delivery);

          // Validate: delivery should look like a month (Mar 26, Apr26, etc.)
          if (delivery && /^[A-Za-z]{3}\s?\d{2}/i.test(delivery)) {
            // Normalize delivery: "Mar 26" → "Mar26"
            const del = delivery.replace(/\s+/g, '');

            const row_data = {
              del,
              cash:  get(colMap.cash),
              basis: get(colMap.basis),
            };

            // Futures month — could be in a dedicated column or same as CBOT
            if (colMap.futuresMonth != null) {
              row_data.month = get(colMap.futuresMonth);
              // If there's a separate futures price column right after futures month,
              // grab it for CBOT reference
              if (colMap.futuresMonth + 1 < cells.length && colMap.cbot == null) {
                const nextVal = cells[colMap.futuresMonth + 1]?.textContent?.trim();
                if (nextVal && /^\d+\.\d+/.test(nextVal)) {
                  row_data.cbot = nextVal;
                }
              }
            }
            if (colMap.change != null) row_data.chg = get(colMap.change);
            if (colMap.cbot != null)   row_data.cbot = get(colMap.cbot);

            result[currentCommodity].push(row_data);
          }
        }
      }

      return result;
    });

    if (!bidData || Object.keys(bidData).length === 0) {
      console.warn(`[${id}] no bid data found`);
      return { locations: {}, source: 'fetch_failed', error: 'no bid data in DTN table' };
    }

    // Parse numeric values
    const parsed = {};
    for (const [commodity, rows] of Object.entries(bidData)) {
      parsed[commodity] = rows.map(r => {
        const entry = {
          delivery:     r.del,
          cash:         parseCash(r.cash),
          basis:        parseBasis(r.basis),
        };
        if (r.month) {
          // Normalize futures month: "May 26" → "May26"
          entry.futuresMonth = r.month.replace(/\s+/g, '');
        }
        if (r.chg)  entry.change = r.chg;
        if (r.cbot) entry.cbot   = parseCbot(r.cbot);
        return entry;
      }).filter(r => r.cash !== null);
    }

    const slug = 'claremont';
    locations[slug] = {
      name: 'Al-Corn',
      ...parsed,
    };

    const cornCount = parsed.corn?.length || 0;
    const beanCount = parsed.beans?.length || 0;
    console.log(`[${id}:${slug}] parsed — corn: ${cornCount} bids, beans: ${beanCount} bids`);

    if (cornCount > 0) {
      console.log(`[${id}:${slug}]   corn nearby: $${parsed.corn[0].cash} basis ${parsed.corn[0].basis} (${parsed.corn[0].delivery})`);
    }
    if (beanCount > 0) {
      console.log(`[${id}:${slug}]   beans nearby: $${parsed.beans[0].cash} basis ${parsed.beans[0].basis} (${parsed.beans[0].delivery})`);
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
    return { locations, source: 'fetch_failed', error: lastError || 'no locations scraped' };
  }

  return { locations, source: 'scraped', error: lastError };
}

module.exports = { parse };
