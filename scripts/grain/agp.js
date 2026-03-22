// scripts/grain/agp.js
// Ag Partners — cash bid scraper
// Parses the DTN cash bids widget on agpartners.net/markets-cashbids/.
// The page uses window.dtn.cashBids.createCashBidsTableWidget() which renders
// a React-based widget into #cash-bids-combined-table.
// Widget config: groupBy LOCATION, with location and commodity selects.
// We iterate through locations via the widget's dropdown, reading the rendered
// table for each — same pattern as cfs.js but for the newer DTN widget.
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

// Convert "Apr 2026" or "Apr26" or "Cash" to short label like "Apr26"
function deliveryLabel(str) {
  if (!str) return null;
  const trimmed = str.trim();
  if (/^cash$/i.test(trimmed)) return 'Cash';
  // "Apr 2026" → "Apr26"
  const m = trimmed.match(/^([A-Za-z]{3})\s*(\d{4})$/);
  if (m) return m[1] + m[2].slice(2);
  // "Apr 26"
  const m2 = trimmed.match(/^([A-Za-z]{3})\s*(\d{2})$/);
  if (m2) return m2[1] + m2[2];
  // "04/01/2026" → "Apr26"
  const m3 = trimmed.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
  if (m3) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = parseInt(m3[1], 10) - 1;
    return months[mon] + m3[2].slice(2);
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

    // Wait for the DTN widget to render — try multiple selectors
    const widgetSelector = '#cash-bids-combined-table';
    console.log(`[${id}] waiting for DTN widget...`);

    // Give the widget time to initialize and render
    await new Promise(r => setTimeout(r, 5000));

    // Wait for a table or data to appear within the widget container
    try {
      await page.waitForFunction(
        (sel) => {
          const container = document.querySelector(sel);
          if (!container) return false;
          // Widget has rendered when it contains a table or rows
          return container.querySelectorAll('table').length > 0
            || container.querySelectorAll('tr').length > 0
            || container.querySelectorAll('[class*="row"]').length > 5;
        },
        { timeout: 15000 },
        widgetSelector
      );
    } catch (e) {
      console.warn(`[${id}] widget table not detected after 15s — trying to parse anyway`);
    }

    await new Promise(r => setTimeout(r, 2000));

    // Log widget structure for debugging
    const widgetInfo = await page.evaluate((sel) => {
      const container = document.querySelector(sel);
      if (!container) return { found: false };
      return {
        found: true,
        innerHTML: container.innerHTML.substring(0, 500),
        tableCount: container.querySelectorAll('table').length,
        selectCount: container.querySelectorAll('select').length,
        trCount: container.querySelectorAll('tr').length,
        divCount: container.querySelectorAll('div').length,
      };
    }, widgetSelector);
    console.log(`[${id}] widget info: ${JSON.stringify(widgetInfo)}`);

    // Find location options — try multiple strategies
    const locationOptions = await page.evaluate((sel, configLocs) => {
      const container = document.querySelector(sel);
      if (!container) return [];

      // Strategy 1: find <select> elements within the widget
      const selects = container.querySelectorAll('select');
      for (const select of selects) {
        const options = Array.from(select.options).map(o => ({
          value: o.value,
          text: o.textContent.trim(),
          selectId: select.id || select.className,
        }));
        // The location select has options matching config location names
        const hasLocMatch = options.some(o =>
          configLocs.some(cl => o.text.toLowerCase().includes(cl.name.toLowerCase()))
        );
        if (hasLocMatch || options.length >= configLocs.length) {
          return options.map(o => ({ ...o, strategy: 'select' }));
        }
      }

      // Strategy 2: look for a custom dropdown with option items
      const dropdowns = container.querySelectorAll('[class*="select"], [class*="dropdown"], [class*="location"]');
      for (const dd of dropdowns) {
        const items = dd.querySelectorAll('option, [class*="option"], li');
        if (items.length >= 2) {
          return Array.from(items).map(item => ({
            value: item.value || item.getAttribute('data-value') || item.textContent.trim(),
            text: item.textContent.trim(),
            strategy: 'custom-dropdown',
          }));
        }
      }

      return [];
    }, widgetSelector, config.locations);

    console.log(`[${id}] found ${locationOptions.length} location options`);
    locationOptions.forEach(o => console.log(`[${id}]   "${o.text}" (${o.strategy})`));

    if (locationOptions.length === 0) {
      // No dropdown found — try parsing whatever data is currently displayed
      console.log(`[${id}] no location dropdown — parsing visible data as single view`);
      const visibleData = await extractTableData(page, widgetSelector);
      if (visibleData && visibleData.length > 0) {
        processVisibleData(id, config, visibleData, locations);
      } else {
        lastError = 'no location options and no visible data';
      }
    } else {
      // Iterate through locations
      const targetLocs = config.locations.length > 0
        ? locationOptions.filter(opt =>
            config.locations.some(cl => opt.text.toLowerCase().includes(cl.name.toLowerCase()))
          )
        : locationOptions.filter(o => o.text && o.text !== 'All' && o.text !== '');

      console.log(`[${id}] will scrape ${targetLocs.length} locations`);

      for (const loc of targetLocs) {
        const slug = slugify(loc.text);
        console.log(`\n[${id}:${slug}] selecting location: "${loc.text}"`);

        try {
          // Select the location
          if (loc.strategy === 'select') {
            // Find the right select element and change its value
            await page.evaluate((sel, locValue) => {
              const container = document.querySelector(sel);
              const selects = container.querySelectorAll('select');
              for (const select of selects) {
                const hasOption = Array.from(select.options).some(o => o.value === locValue);
                if (hasOption) {
                  select.value = locValue;
                  select.dispatchEvent(new Event('change', { bubbles: true }));
                  break;
                }
              }
            }, widgetSelector, loc.value);
          } else {
            // Click the custom dropdown option
            await page.evaluate((sel, locText) => {
              const container = document.querySelector(sel);
              const items = container.querySelectorAll('[class*="option"], li, option');
              for (const item of items) {
                if (item.textContent.trim() === locText) {
                  item.click();
                  break;
                }
              }
            }, widgetSelector, loc.text);
          }

          // Wait for data to update
          await new Promise(r => setTimeout(r, 3000));

          // Parse the bid data
          const bidData = await extractTableData(page, widgetSelector);

          if (!bidData || bidData.length === 0) {
            console.warn(`[${id}:${slug}] no bid data found`);
            continue;
          }

          locations[slug] = { name: loc.text, corn: [], beans: [] };

          for (const bid of bidData) {
            const entry = {
              delivery:     deliveryLabel(bid.delivery),
              cash:         parseCash(bid.cash),
              futuresMonth: bid.symbol || null,
              basis:        parseBasis(bid.basis),
              change:       bid.change || null,
              cbot:         bid.futures || null,
            };

            if (entry.cash !== null && entry.delivery) {
              const commodity = bid.commodity || 'corn';
              if (!locations[slug][commodity]) locations[slug][commodity] = [];
              locations[slug][commodity].push(entry);
            }
          }

          const cornCount = locations[slug].corn?.length || 0;
          const beanCount = locations[slug].beans?.length || 0;
          console.log(`[${id}:${slug}] parsed — corn: ${cornCount} bids, beans: ${beanCount} bids`);
          if (cornCount > 0) {
            console.log(`[${id}:${slug}]   corn nearby: $${locations[slug].corn[0].cash} basis ${locations[slug].corn[0].basis} (${locations[slug].corn[0].delivery})`);
          }
          if (beanCount > 0) {
            console.log(`[${id}:${slug}]   beans nearby: $${locations[slug].beans[0].cash} basis ${locations[slug].beans[0].basis} (${locations[slug].beans[0].delivery})`);
          }

        } catch (locErr) {
          console.error(`[${id}:${slug}] FAILED: ${locErr.message}`);
          lastError = locErr.message;
        }
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
    return { locations, source: 'fetch_failed', error: lastError || 'no locations scraped' };
  }

  return { locations, source: 'scraped', error: lastError };
}

// ── Extract table data from the widget ──────────────────────────────────────

async function extractTableData(page, containerSel) {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (!container) return [];

    const results = [];
    let currentCommodity = null;

    // Strategy 1: standard <table> with rows
    const tables = container.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr, tbody tr');

      // Try to detect column mapping from header row
      const headerRow = table.querySelector('thead tr, tr:first-child');
      const headers = headerRow
        ? Array.from(headerRow.querySelectorAll('th, td')).map(c => c.textContent.trim().toUpperCase())
        : [];

      // Map column indices
      const colMap = {};
      headers.forEach((h, i) => {
        if (/COMMODITY|NAME/i.test(h)) colMap.commodity = i;
        if (/DELIVERY|DEL/i.test(h) && !colMap.delivery) colMap.delivery = i;
        if (/CASH\s*PRICE|CASH/i.test(h)) colMap.cash = i;
        if (/BASIS/i.test(h)) colMap.basis = i;
        if (/CHANGE|CHG/i.test(h)) colMap.change = i;
        if (/SYMBOL/i.test(h)) colMap.symbol = i;
        if (/FUTURES\s*QUOTE|FUTURES\s*PRICE|FUTURES/i.test(h) && !colMap.futures) colMap.futures = i;
      });

      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length === 0) continue;
        const rowText = row.textContent.trim().toUpperCase();

        // Detect commodity header rows
        if (/^CORN\s*$/.test(rowText) || rowText === 'CORN') {
          currentCommodity = 'corn';
          continue;
        }
        if (/^SOYBEANS?\s*$/.test(rowText) || rowText === 'SOYBEANS' || rowText === 'BEANS') {
          currentCommodity = 'beans';
          continue;
        }

        // Check if first cell is a commodity name (for inline commodity column)
        const firstText = (cells[0]?.textContent || '').trim().toUpperCase();
        if (firstText === 'CORN' || firstText === 'SOYBEANS' || firstText === 'BEANS') {
          currentCommodity = (firstText === 'CORN') ? 'corn' : 'beans';
        }

        // Skip header/label rows
        if (/^(LOCATION|DELIVERY|DEL|COMMODITY|NAME)\b/i.test(rowText)) continue;

        if (cells.length < 3) continue;

        // Extract using column map if available, otherwise positional
        let bid;
        if (Object.keys(colMap).length >= 2) {
          bid = {
            commodity: currentCommodity || ((cells[colMap.commodity]?.textContent || '').trim().toUpperCase().includes('SOY') ? 'beans' : 'corn'),
            delivery:  (cells[colMap.delivery]?.textContent || '').trim(),
            cash:      (cells[colMap.cash]?.textContent || '').trim(),
            basis:     colMap.basis != null ? (cells[colMap.basis]?.textContent || '').trim() : null,
            change:    colMap.change != null ? (cells[colMap.change]?.textContent || '').trim() : null,
            symbol:    colMap.symbol != null ? (cells[colMap.symbol]?.textContent || '').trim() : null,
            futures:   colMap.futures != null ? (cells[colMap.futures]?.textContent || '').trim() : null,
          };
        } else {
          // Fallback: guess column layout
          // Common DTN layout: Delivery | Change | Cash Price | Basis | Symbol | Futures
          // Or: Location | Delivery | Change | Cash | Basis | Symbol | Futures
          const offset = cells.length >= 7 ? 1 : 0; // skip location column if present
          bid = {
            commodity: currentCommodity || 'corn',
            delivery:  (cells[0 + offset]?.textContent || '').trim(),
            change:    (cells[1 + offset]?.textContent || '').trim(),
            cash:      (cells[2 + offset]?.textContent || '').trim(),
            basis:     (cells[3 + offset]?.textContent || '').trim(),
            symbol:    cells.length > 4 + offset ? (cells[4 + offset]?.textContent || '').trim() : null,
            futures:   cells.length > 5 + offset ? (cells[5 + offset]?.textContent || '').trim() : null,
          };
        }

        // Validate: cash should look like a price
        if (bid.cash && /\d/.test(bid.cash)) {
          results.push(bid);
        }
      }
    }

    return results;
  }, containerSel);
}

// ── Process visible data when no location dropdown is found ─────────────────

function processVisibleData(id, config, visibleData, locations) {
  // Group by location name if present in the data, otherwise use first config location
  for (const bid of visibleData) {
    const locName = bid.location || config.locations[0]?.name || 'Unknown';
    const slug = slugify(locName);

    if (!locations[slug]) {
      locations[slug] = { name: locName, corn: [], beans: [] };
    }

    const entry = {
      delivery:     deliveryLabel(bid.delivery),
      cash:         parseCash(bid.cash),
      futuresMonth: bid.symbol || null,
      basis:        parseBasis(bid.basis),
      change:       bid.change || null,
      cbot:         bid.futures || null,
    };

    if (entry.cash !== null && entry.delivery) {
      const commodity = bid.commodity || 'corn';
      if (!locations[slug][commodity]) locations[slug][commodity] = [];
      locations[slug][commodity].push(entry);
    }
  }
}

module.exports = { parse };
