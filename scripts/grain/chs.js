// scripts/grain/chs.js
// CHS — cash bid scraper (discovery run)
// The cash bids page at chsag.com/grain/cash-bids/ loads bid data dynamically
// via a JavaScript widget. This first version inspects the rendered DOM to
// determine the widget type and table structure.
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

function parseBasis(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.\-]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function deliveryLabel(str) {
  if (!str) return null;
  const trimmed = str.trim();
  if (/^cash$/i.test(trimmed)) return 'Cash';
  const m = trimmed.match(/^([A-Za-z]{3})\s*(\d{4})$/);
  if (m) return m[1] + m[2].slice(2);
  const m2 = trimmed.match(/^([A-Za-z]{3})\s*(\d{2})$/);
  if (m2) return m2[1] + m2[2];
  const m3 = trimmed.match(/^(\d{1,2})\/\d{1,2}\/(\d{2,4})$/);
  if (m3) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = parseInt(m3[1], 10) - 1;
    const yr = m3[2].length === 4 ? m3[2].slice(2) : m3[2];
    return months[mon] + yr;
  }
  return trimmed;
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const locations = {};
  let lastError = null;
  const page = await browser.newPage();

  try {
    console.log(`[${id}] navigating to ${config.url}`);
    await page.goto(config.url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    // ── Phase 1: Discover the page structure ──────────────────────────────
    const discovery = await page.evaluate(() => {
      const body = document.body;
      return {
        title: document.title,
        bodyLength: body?.innerHTML?.length || 0,
        // Look for common widget patterns
        hasDtn: !!document.querySelector('[class*="dtn"], [class*="cash-bid"], [id*="dtn"], [id*="cashbid"]'),
        hasBarchart: !!document.querySelector('[class*="barchart"], [id*="barchart"]'),
        // Tables
        tableCount: document.querySelectorAll('table').length,
        tables: Array.from(document.querySelectorAll('table')).slice(0, 5).map((t, i) => ({
          index: i,
          id: t.id,
          className: t.className,
          rowCount: t.querySelectorAll('tr').length,
          firstRowText: t.querySelector('tr')?.textContent?.trim()?.substring(0, 100),
        })),
        // Selects (location/commodity dropdowns)
        selects: Array.from(document.querySelectorAll('select')).map(s => ({
          id: s.id,
          className: s.className,
          name: s.name,
          optionCount: s.options.length,
          options: Array.from(s.options).slice(0, 10).map(o => ({ value: o.value, text: o.textContent.trim() })),
        })),
        // Iframes
        iframes: Array.from(document.querySelectorAll('iframe')).map(f => ({
          src: f.src,
          id: f.id,
          width: f.width,
          height: f.height,
        })),
        // Look for DTN widget containers
        dtnContainers: Array.from(document.querySelectorAll('[class*="cash-bid"], [class*="widget"], [id*="cash-bid"], [id*="widget"]')).map(el => ({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          childCount: el.children.length,
          textPreview: el.textContent?.trim()?.substring(0, 200),
        })),
        // Any script srcs that look relevant
        scripts: Array.from(document.querySelectorAll('script[src]')).map(s => s.src).filter(s =>
          /dtn|barchart|cashbid|grain|widget|commodity/i.test(s)
        ),
        // Look for any element containing commodity keywords
        cornElements: document.querySelectorAll('*').length,
        // Search for text "Corn" or "Soybeans" in visible elements
        hasCornText: body?.innerText?.includes('Corn') || false,
        hasSoyText: body?.innerText?.includes('Soy') || false,
        hasLocationText: body?.innerText?.includes('Fairmont') || false,
        // First 500 chars of visible text for context
        visibleTextPreview: body?.innerText?.substring(0, 500),
      };
    });

    console.log(`[${id}] discovery: ${JSON.stringify(discovery, null, 2)}`);

    // ── Phase 2: Try to parse if we found tables/widgets ──────────────────
    if (discovery.tableCount > 0) {
      console.log(`[${id}] found ${discovery.tableCount} tables — attempting parse`);

      const tableData = await page.evaluate((configLocs) => {
        const results = {};
        const tables = document.querySelectorAll('table');

        for (const table of tables) {
          const rows = table.querySelectorAll('tr');
          if (rows.length < 2) continue;

          let currentCommodity = null;
          let currentLocation = null;

          for (const row of rows) {
            const cells = row.querySelectorAll('td, th');
            const rowText = row.textContent.trim().toUpperCase();

            // Detect location
            for (const loc of configLocs) {
              if (rowText.includes(loc.name.toUpperCase())) {
                currentLocation = loc.name;
              }
            }

            // Detect commodity
            if (/\bCORN\b/.test(rowText) && cells.length <= 2) {
              currentCommodity = 'corn';
              continue;
            }
            if (/\bSOYBEAN/.test(rowText) && cells.length <= 2) {
              currentCommodity = 'beans';
              continue;
            }

            if (!currentCommodity || cells.length < 3) continue;

            // Log row data for inspection
            const cellTexts = Array.from(cells).map(c => c.textContent.trim().substring(0, 50));
            const key = (currentLocation || 'unknown') + '|' + currentCommodity;
            if (!results[key]) results[key] = [];
            results[key].push(cellTexts);
          }
        }
        return results;
      }, config.locations);

      console.log(`[${id}] table parse results: ${JSON.stringify(tableData)}`);
    }

    // ── Phase 3: Check for DTN widget with location select ────────────────
    if (discovery.selects.length > 0) {
      console.log(`[${id}] found ${discovery.selects.length} select elements — checking for location dropdown`);
      for (const sel of discovery.selects) {
        console.log(`[${id}]   select: id="${sel.id}" class="${sel.className}" options=${sel.optionCount}`);
        sel.options.forEach(o => console.log(`[${id}]     "${o.text}" (${o.value})`));
      }
    }

    lastError = 'discovery run — parser not yet implemented';

  } catch (err) {
    console.error(`[${id}] SCRAPE FAILED: ${err.message}`);
    return { locations: {}, source: 'fetch_failed', error: err.message };
  } finally {
    await page.close();
  }

  return { locations, source: 'fetch_failed', error: lastError };
}

module.exports = { parse };
