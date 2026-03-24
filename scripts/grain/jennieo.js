// scripts/grain/jennieo.js
// Jennie-O Turkey Store — corn cash bid scraper
// Source: farmbucks.com/grain-prices/jennie-o/minnesota
// Static HTML table — no widgets or dynamic loading.
// Table ID: gpl-table-2-yellow-corn
// Columns: Location | Delivery | Cash Price
// All 4 MN locations in one filterable table. Corn only.
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

// Convert "August 2026" or "Aug 2026" → "Aug26"
function deliveryLabel(str) {
  if (!str) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = str.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mon = months.find(mo => m[1].toLowerCase().startsWith(mo.toLowerCase()));
    if (mon) return mon + m[2].slice(2);
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
      const table = document.querySelector('#gpl-table-2-yellow-corn');
      if (!table) return { rows: [], debug: 'no table #gpl-table-2-yellow-corn found' };

      const trs = table.querySelectorAll('tbody tr');
      const rows = [];

      for (const tr of trs) {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 3) continue;

        const location = (cells[0]?.textContent || '').trim();
        const delivery = (cells[1]?.textContent || '').trim();
        const cashRaw  = (cells[2]?.textContent || '').trim();

        // Skip header-like rows
        if (/^location$/i.test(location)) continue;

        // Only capture configured locations
        if (!configNames.some(cn => location.toLowerCase().includes(cn))) continue;

        rows.push({ location, delivery, cash: cashRaw });
      }

      return { rows, debug: `${trs.length} table rows, ${rows.length} matched` };
    }, configNames);

    console.log(`[${id}] ${allBids.debug}`);

    // Match each row to its configured location name
    for (const row of allBids.rows) {
      const matchedLoc = config.locations.find(l =>
        row.location.toLowerCase().includes(l.name.toLowerCase())
      );
      if (!matchedLoc) continue;

      const slug = slugify(matchedLoc.name);
      if (!locations[slug]) {
        locations[slug] = { name: matchedLoc.name, corn: [], beans: [] };
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
