// scripts/grain/newvision.js
// New Vision Cooperative — grain cash bid scraper
// Source: newvision.coop/current-grain-prices/?format=grid&groupby=location
// JS-rendered page with per-location table blocks.
// Columns: Commodity row × delivery month columns. Cash-only (no basis/futures).
// 22 locations across southern MN.
// robots.txt Crawl-delay: 10 — respected via 10s post-load wait.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// Convert "Mar 26" or "March 2026" or "Mar26" → "Mar26"
function deliveryLabel(str) {
  if (!str) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const trimmed = str.trim();

  // "Mar 26" or "Mar26"
  const short = trimmed.match(/^([A-Za-z]{3})\s*(\d{2})$/);
  if (short) {
    const mon = months.find(m => m.toLowerCase() === short[1].toLowerCase());
    if (mon) return mon + short[2];
  }

  // "March 2026" or "Mar 2026"
  const long = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (long) {
    const mon = months.find(m => long[1].toLowerCase().startsWith(m.toLowerCase()));
    if (mon) return mon + long[2].slice(2);
  }

  return trimmed;
}

// ── Main Parse Function ─────────────────────────────────────────────────────
// Receives: { id, config, browser }
// Returns:  { locations: { [slug]: { name, corn, beans } }, source, error }

async function parse({ id, config, browser }) {
  const locations = {};
  let lastError = null;
  const page = await browser.newPage();

  try {
    console.log(`[${id}] navigating to ${config.url}`);
    await page.goto(config.url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Respect robots.txt Crawl-delay: 10
    console.log(`[${id}] respecting crawl-delay — waiting 10s`);
    await new Promise(r => setTimeout(r, 10000));

    // Wait for table content to render (JS-rendered page)
    await page.waitForSelector('table', { timeout: 15000 })
      .catch(() => console.warn(`[${id}] no table found after wait — trying anyway`));

    // Extra settle time for JS rendering
    await new Promise(r => setTimeout(r, 3000));

    // Extract all location blocks from the page
    const rawData = await page.evaluate(() => {
      const results = [];

      // Strategy: find all location header elements followed by tables.
      // The page groups by location — each block has a header + table.
      // Try multiple selector patterns since the exact structure may vary.

      // Pattern 1: look for distinct section/block containers
      const blocks = document.querySelectorAll(
        '.location-block, .grid-section, .cashbid-location, ' +
        '[class*="location"], [class*="Location"]'
      );

      if (blocks.length > 0) {
        for (const block of blocks) {
          const header = block.querySelector('h1, h2, h3, h4, h5, .location-name, [class*="header"]');
          const table = block.querySelector('table');
          if (!header || !table) continue;

          const locationName = header.textContent.trim();
          if (!locationName) continue;

          results.push(extractTable(locationName, table));
        }
      }

      // Pattern 2: if no blocks found, look for headers followed by tables
      if (results.length === 0) {
        const allHeaders = document.querySelectorAll('h1, h2, h3, h4, h5');
        for (const header of allHeaders) {
          const locationName = header.textContent.trim();
          if (!locationName) continue;

          // Find the next sibling table
          let sibling = header.nextElementSibling;
          let attempts = 0;
          while (sibling && attempts < 5) {
            if (sibling.tagName === 'TABLE') {
              results.push(extractTable(locationName, sibling));
              break;
            }
            // Check if sibling contains a table
            const innerTable = sibling.querySelector('table');
            if (innerTable) {
              results.push(extractTable(locationName, innerTable));
              break;
            }
            sibling = sibling.nextElementSibling;
            attempts++;
          }
        }
      }

      // Pattern 3: single large table with location rows
      if (results.length === 0) {
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
          const headers = table.querySelectorAll('th');
          const rows = table.querySelectorAll('tbody tr, tr');
          if (headers.length < 2 || rows.length < 2) continue;

          // Check if this looks like a grouped-by-location table
          // Headers might be: Location | Commodity | delivery months...
          const headerTexts = Array.from(headers).map(h => h.textContent.trim());

          // Look for delivery month columns
          const monthPattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{2}/i;
          const deliveryHeaders = headerTexts.filter(h => monthPattern.test(h));

          if (deliveryHeaders.length > 0) {
            results.push({ type: 'flat-table', headerTexts, deliveryHeaders, rowCount: rows.length });

            // Parse the flat table
            let currentLocation = null;
            for (const row of rows) {
              const cells = row.querySelectorAll('td, th');
              if (cells.length < 2) continue;

              const cellTexts = Array.from(cells).map(c => c.textContent.trim());

              // Detect location header rows (often span multiple columns or are bold)
              const firstCell = cells[0];
              const colspan = parseInt(firstCell.getAttribute('colspan') || '1');
              if (colspan > 1 || (cells.length <= 2 && !monthPattern.test(cellTexts[1]))) {
                const possibleLoc = cellTexts[0];
                if (possibleLoc && possibleLoc.length > 2 && !/^(corn|soybeans|beans)$/i.test(possibleLoc)) {
                  currentLocation = possibleLoc;
                  continue;
                }
              }

              // Detect commodity rows
              const commodity = cellTexts[0];
              if (currentLocation && /^(corn|soybeans|beans)$/i.test(commodity)) {
                const bids = [];
                for (let i = 1; i < cells.length && i <= deliveryHeaders.length; i++) {
                  const price = cellTexts[i];
                  if (price && price !== '-' && price !== '') {
                    bids.push({ delivery: deliveryHeaders[i - 1], cash: price });
                  }
                }
                results.push({
                  type: 'flat-row',
                  location: currentLocation,
                  commodity: commodity,
                  bids: bids,
                });
              }
            }
          }
        }
      }

      return results;

      // Helper: extract commodity rows from a per-location table
      function extractTable(locationName, table) {
        const headers = Array.from(table.querySelectorAll('thead th, th'))
          .map(th => th.textContent.trim());
        const rows = table.querySelectorAll('tbody tr, tr');
        const commodities = {};

        // Find delivery month columns from headers
        const monthPattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{2}/i;
        const deliveryIndices = [];
        const deliveryLabels = [];
        for (let i = 0; i < headers.length; i++) {
          if (monthPattern.test(headers[i])) {
            deliveryIndices.push(i);
            deliveryLabels.push(headers[i]);
          }
        }

        for (const row of rows) {
          const cells = row.querySelectorAll('td, th');
          if (cells.length < 2) continue;
          const commodity = (cells[0]?.textContent || '').trim();

          if (/^corn$/i.test(commodity) || /^soybeans?$/i.test(commodity) || /^beans$/i.test(commodity)) {
            const key = /^corn$/i.test(commodity) ? 'corn' : 'beans';
            const bids = [];
            for (let j = 0; j < deliveryIndices.length; j++) {
              const idx = deliveryIndices[j];
              const price = (cells[idx]?.textContent || '').trim();
              if (price && price !== '-' && price !== '') {
                bids.push({ delivery: deliveryLabels[j], cash: price });
              }
            }
            commodities[key] = bids;
          }
        }

        return { type: 'block', location: locationName, commodities, headers, deliveryLabels };
      }
    });

    console.log(`[${id}] raw extraction: ${rawData.length} items`);

    // Build config location lookup
    const configLookup = {};
    for (const loc of (config.locations || [])) {
      configLookup[loc.name.toLowerCase()] = loc;
    }

    // Process extracted data into final locations object
    for (const item of rawData) {
      if (item.type === 'block') {
        const matchedLoc = matchLocation(item.location, configLookup, config.locations);
        if (!matchedLoc) {
          console.log(`[${id}] skipping unmatched location: "${item.location}"`);
          continue;
        }

        const slug = matchedLoc.slug || slugify(matchedLoc.name);
        locations[slug] = {
          name: matchedLoc.name,
          corn: (item.commodities.corn || []).map(b => ({
            delivery:     deliveryLabel(b.delivery),
            cash:         parseCash(b.cash),
            futuresMonth: null,
            basis:        null,
            change:       null,
            cbot:         null,
          })).filter(b => b.cash !== null && b.delivery),
          beans: (item.commodities.beans || []).map(b => ({
            delivery:     deliveryLabel(b.delivery),
            cash:         parseCash(b.cash),
            futuresMonth: null,
            basis:        null,
            change:       null,
            cbot:         null,
          })).filter(b => b.cash !== null && b.delivery),
        };
      } else if (item.type === 'flat-row') {
        const matchedLoc = matchLocation(item.location, configLookup, config.locations);
        if (!matchedLoc) continue;

        const slug = matchedLoc.slug || slugify(matchedLoc.name);
        if (!locations[slug]) {
          locations[slug] = { name: matchedLoc.name, corn: [], beans: [] };
        }

        const key = /^corn$/i.test(item.commodity) ? 'corn' : 'beans';
        locations[slug][key] = (item.bids || []).map(b => ({
          delivery:     deliveryLabel(b.delivery),
          cash:         parseCash(b.cash),
          futuresMonth: null,
          basis:        null,
          change:       null,
          cbot:         null,
        })).filter(b => b.cash !== null && b.delivery);
      }
    }

    // Ensure all configured locations exist (even if empty)
    for (const loc of (config.locations || [])) {
      const slug = loc.slug || slugify(loc.name);
      if (!locations[slug]) {
        locations[slug] = { name: loc.name, corn: [], beans: [] };
      }
    }

    // Log results
    for (const [slug, data] of Object.entries(locations)) {
      const cc = data.corn?.length || 0;
      const bc = data.beans?.length || 0;
      console.log(`[${id}:${slug}] corn: ${cc} bids, beans: ${bc} bids`);
      if (cc > 0) console.log(`[${id}:${slug}]   corn nearby: $${data.corn[0].cash} (${data.corn[0].delivery})`);
      if (bc > 0) console.log(`[${id}:${slug}]   beans nearby: $${data.beans[0].cash} (${data.beans[0].delivery})`);
    }

  } catch (err) {
    console.error(`[${id}] SCRAPE FAILED: ${err.message}`);
    return { locations: {}, source: 'fetch_failed', error: err.message };
  } finally {
    await page.close();
  }

  const locCount = Object.keys(locations).length;
  const withData = Object.values(locations).filter(l => l.corn.length > 0 || l.beans.length > 0).length;
  console.log(`\n[${id}] scrape complete — ${locCount} locations (${withData} with data)`);

  if (withData === 0) {
    return { locations, source: 'fetch_failed', error: lastError || 'no locations with bid data' };
  }

  return { locations, source: 'scraped', error: lastError };
}

// ── Location matching ────────────────────────────────────────────────────────
// Match a scraped location name to a configured location entry

function matchLocation(scrapedName, configLookup, configLocations) {
  if (!scrapedName) return null;
  const lower = scrapedName.trim().toLowerCase();

  // Exact match on name
  if (configLookup[lower]) return configLookup[lower];

  // Partial match — scraped name contains or is contained by config name
  for (const loc of (configLocations || [])) {
    const confLower = loc.name.toLowerCase();
    if (lower.includes(confLower) || confLower.includes(lower)) {
      return loc;
    }
  }

  return null;
}

module.exports = { parse };
