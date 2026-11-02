// scripts/grain/jennieo.js
// Jennie-O Turkey Store — corn cash bid scraper
// Source: farmbucks.com/grain-prices/jennie-o/minnesota
// Static HTML table — no widgets or dynamic loading.
// Table ID: gpl-table-2-yellow-corn
// Columns: Location | Delivery | Cash Price
// Location cell uses rowspan, so only a location's first row has 3 cells;
// the rest are Delivery | Cash Price. Corn only.
// ~2026-10-15 farmbucks shortened names ("Atwater Feed Mill" → "Atwater") and
// dropped Faribault. Matching runs both ways so config names (and slugs the
// PWA keys on) stay unchanged.
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

    // Configured location names for matching
    const configNames = config.locations.map(l => l.name);

    const allBids = await page.evaluate((configNames) => {
      const table = document.querySelector('#gpl-table-2-yellow-corn');
      if (!table) return { rows: [], debug: 'no table #gpl-table-2-yellow-corn found' };

      const trs = table.querySelectorAll('tbody tr');
      const rows = [];
      let currentLocation = null;

      for (const tr of trs) {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 2) continue;

        // 3 cells = new location row; 2 cells = continuation of the rowspan
        const hasLoc   = cells.length >= 3;
        const locCell  = hasLoc ? cells[0] : null;
        const locText  = locCell
          ? (locCell.querySelector('.gpl-bold')?.textContent || locCell.textContent || '').trim()
          : '';
        const delivery = (cells[hasLoc ? 1 : 0]?.textContent || '').trim();
        const cashRaw  = (cells[hasLoc ? 2 : 1]?.textContent || '').trim();

        // Skip header-like rows
        if (/^location$/i.test(locText)) continue;

        // New location row: map page name to configured name (either may contain the other)
        if (hasLoc) {
          const lt = locText.toLowerCase();
          currentLocation = lt
            ? configNames.find(cn => lt.includes(cn.toLowerCase()) || cn.toLowerCase().includes(lt)) || null
            : null;
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

    // Rows already carry their configured location name
    for (const row of allBids.rows) {
      const matchedLoc = config.locations.find(l => l.name === row.location);
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
