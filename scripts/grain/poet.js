// scripts/grain/poet.js
// POET Biorefining — corn cash bid scraper via Farmbucks
// Source: farmbucks.com/grain-prices/poet
// Static HTML table — same platform as Jennie-O.
// Table class: gpl-table  (may also have id like gpl-table-2-yellow-corn)
// Columns: Location | Delivery | Cash Price
// All locations in one table; parser filters to configured MN locations only.
// Corn only (POET is an ethanol producer).
// robots.txt: /grain-prices/ is allowed.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

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

// Convert "March 2026" or "Oct–Nov 2026" → "Mar26" or "Oct-Nov26"
function deliveryLabel(str) {
  if (!str) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Range like "Oct–Nov 2026"
  const range = str.trim().match(/^([A-Za-z]+)[–\-]\s*([A-Za-z]+)\s+(\d{4})$/);
  if (range) {
    const m1 = months.find(mo => range[1].toLowerCase().startsWith(mo.toLowerCase()));
    const m2 = months.find(mo => range[2].toLowerCase().startsWith(mo.toLowerCase()));
    if (m1 && m2) return m1 + '-' + m2 + range[3].slice(2);
  }

  // Single month like "March 2026" or "Apr 2026"
  const single = str.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (single) {
    const mon = months.find(mo => single[1].toLowerCase().startsWith(mo.toLowerCase()));
    if (mon) return mon + single[2].slice(2);
  }

  // Partial date like "Apr 1–10, 2026" — take the month + year
  const partial = str.trim().match(/^([A-Za-z]+)\s+\d.*(\d{4})$/);
  if (partial) {
    const mon = months.find(mo => partial[1].toLowerCase().startsWith(mo.toLowerCase()));
    if (mon) return mon + partial[2].slice(2);
  }

  return str.trim();
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const locations = {};
  let lastError = null;
  const page = await browser.newPage();

  try {
    console.log(`[${id}] navigating to ${config.url}`);
    await page.goto(config.url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Build set of configured location names for matching
    const configNames = config.locations.map(l => l.name.toLowerCase());

    const allBids = await page.evaluate((configNames) => {
      // Try multiple selectors — Farmbucks may use id or class
      const table = document.querySelector('#gpl-table-2-yellow-corn') ||
                    document.querySelector('#gpl-table-corn') ||
                    document.querySelector('table.gpl-table');
      if (!table) return { rows: [], debug: 'no gpl table found' };

      const trs = table.querySelectorAll('tbody tr');
      const rows = [];
      let currentLocation = null;

      for (const tr of trs) {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 2) continue;

        let locText, delivery, cashRaw;

        if (cells.length >= 3) {
          // Full row: Location | Delivery | Cash Price
          locText  = (cells[0]?.textContent || '').trim();
          delivery = (cells[1]?.textContent || '').trim();
          cashRaw  = (cells[2]?.textContent || '').trim();
        } else {
          // Continuation row (rowspan on location): Delivery | Cash Price
          locText  = '';
          delivery = (cells[0]?.textContent || '').trim();
          cashRaw  = (cells[1]?.textContent || '').trim();
        }

        // Skip header-like rows
        if (/^location$/i.test(locText)) continue;

        // If location cell has text, check if it's a Minnesota location we want
        if (locText) {
          const matched = configNames.some(cn => locText.toLowerCase().includes(cn));
          currentLocation = matched ? locText : null;
        }

        // Skip rows outside configured locations
        if (!currentLocation) continue;
        // Skip rows without a delivery month
        if (!delivery) continue;

        rows.push({ location: currentLocation, delivery, cash: cashRaw });
      }

      return { rows, debug: `${trs.length} table rows, ${rows.length} matched` };
    }, configNames);

    console.log(`[${id}] ${allBids.debug}`);

    // Match each row to its configured location
    for (const row of allBids.rows) {
      const matchedLoc = config.locations.find(l =>
        row.location.toLowerCase().includes(l.name.toLowerCase())
      );
      if (!matchedLoc) continue;

      const slug = slugify(matchedLoc.name);
      if (!locations[slug]) {
        locations[slug] = { name: matchedLoc.name, corn: [] };
      }

      const entry = {
        delivery:     deliveryLabel(row.delivery),
        cash:         parseCash(row.cash),
        futuresMonth: null,
        basis:        null,
        change:       null,
        cbot:         null,
      };

      if (entry.cash !== null && entry.delivery) {
        locations[slug].corn.push(entry);
      }
    }

    // Log results
    for (const [slug, data] of Object.entries(locations)) {
      const cc = data.corn?.length || 0;
      console.log(`[${id}:${slug}] corn: ${cc} bids`);
      if (cc > 0) console.log(`[${id}:${slug}]   corn nearby: $${data.corn[0].cash} (${data.corn[0].delivery})`);
    }

  } catch (err) {
    console.error(`[${id}] SCRAPE FAILED: ${err.message}`);
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
