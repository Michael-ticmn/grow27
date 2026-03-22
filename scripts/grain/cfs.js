// scripts/grain/cfs.js
// Central Farm Service — cash bid scraper
// Parses the DTN Cashbid widget on cfscoop.com.
// Uses Puppeteer to select each location from the dropdown,
// then reads the rendered <table id="dtn-bids"> for corn and beans.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────

// Normalize location name to a slug for use as a key
function slugify(name) {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// Parse a cash price string like "4.1550" → 4.155
function parseCash(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.\-]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

// Parse a basis string like "-0.5000" → -0.5
function parseBasis(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.\-]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

// Parse CBOT string like "465'4s" → keep as string (futures notation)
function parseCbot(str) {
  if (!str) return null;
  return str.trim() || null;
}

// ── Main Parse Function ─────────────────────────────────────────────────────
// Receives: { id, config, browser }
// Returns:  { locations: { [slug]: { corn: [...], beans: [...] } }, source, error }

async function parse({ id, config, browser }) {
  const url = config.url;
  const configLocations = config.locations || [];
  const locations = {};
  let lastError = null;

  console.log(`[${id}] navigating to ${url}`);
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait for the DTN widget to render
    await page.waitForSelector('select[id*="dtnCashbidDetailLocation"]', { timeout: 15000 });
    console.log(`[${id}] page loaded, DTN widget found`);

    // Extra settle time for widget JS
    await new Promise(r => setTimeout(r, 2000));

    // Get all location options from the dropdown
    const dropdownOptions = await page.evaluate(() => {
      const select = document.querySelector('select[id*="dtnCashbidDetailLocation"]');
      if (!select) return [];
      return Array.from(select.options).map(opt => ({
        value: opt.value,
        text:  opt.textContent.trim(),
      }));
    });

    console.log(`[${id}] dropdown has ${dropdownOptions.length} locations:`);
    dropdownOptions.forEach(o => console.log(`[${id}]   "${o.text}" (value: ${o.value})`));

    // Filter to configured locations (or use all if none specified)
    const targetLocations = configLocations.length > 0
      ? dropdownOptions.filter(opt =>
          configLocations.some(cl => cl.name.toLowerCase() === opt.text.toLowerCase())
        )
      : dropdownOptions;

    console.log(`[${id}] will scrape ${targetLocations.length} locations`);

    for (const loc of targetLocations) {
      const slug = slugify(loc.text);
      console.log(`\n[${id}:${slug}] selecting location: "${loc.text}"`);

      try {
        // Select the location in the dropdown
        await page.select('select[id*="dtnCashbidDetailLocation"]', loc.value);

        // Wait for the table to update — DTN widget reloads content via AJAX
        await new Promise(r => setTimeout(r, 3000));

        // Wait for table to exist
        await page.waitForSelector('#dtn-bids, table[summary="Cash Bid Offers"]', { timeout: 10000 })
          .catch(() => console.warn(`[${id}:${slug}] table not found after select — trying anyway`));

        // Parse the bid table
        const bidData = await page.evaluate(() => {
          const table = document.querySelector('#dtn-bids') ||
                        document.querySelector('table[summary="Cash Bid Offers"]');
          if (!table) return null;

          const result = {};
          let currentCommodity = null;

          // The DTN table structure:
          // <table id="dtn-bids">
          //   <tbody>
          //     <tr><td><table> (per commodity section)
          //       Header row with commodity name (CORN, BEANS, etc.)
          //       Column headers: Del, Cash, Month, Basis, Chg, Cbot
          //       Data rows with bid info
          const allRows = table.querySelectorAll('tr');

          for (const row of allRows) {
            const cells = row.querySelectorAll('td, th');
            const text = row.textContent.trim().toUpperCase();

            // Detect commodity header rows
            if (text === 'CORN' || text === 'SOYBEANS' || text === 'BEANS') {
              currentCommodity = text === 'SOYBEANS' || text === 'BEANS' ? 'beans' : 'corn';
              result[currentCommodity] = [];
              continue;
            }

            // Skip column header rows
            if (/^DEL\s/i.test(text) || /DELIVERY/i.test(text)) continue;

            // Parse data rows (need at least 4 cells: Del, Cash, Month, Basis)
            if (currentCommodity && cells.length >= 4) {
              const del   = cells[0]?.textContent?.trim();
              const cash  = cells[1]?.textContent?.trim();
              const month = cells[2]?.textContent?.trim();
              const basis = cells[3]?.textContent?.trim();
              const chg   = cells.length > 4 ? cells[4]?.textContent?.trim() : null;
              const cbot  = cells.length > 5 ? cells[5]?.textContent?.trim() : null;

              // Validate: delivery should look like a month (Mar26, Apr26, etc.)
              if (del && /^[A-Za-z]{3}\d{2}/.test(del)) {
                result[currentCommodity].push({ del, cash, month, basis, chg, cbot });
              }
            }
          }

          return result;
        });

        if (!bidData || Object.keys(bidData).length === 0) {
          console.warn(`[${id}:${slug}] no bid data found`);
          continue;
        }

        // Parse numeric values
        const parsed = {};
        for (const [commodity, rows] of Object.entries(bidData)) {
          parsed[commodity] = rows.map(r => ({
            delivery:     r.del,
            cash:         parseCash(r.cash),
            futuresMonth: r.month || null,
            basis:        parseBasis(r.basis),
            change:       r.chg || null,
            cbot:         parseCbot(r.cbot),
          })).filter(r => r.cash !== null);
        }

        locations[slug] = {
          name: loc.text,
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

      } catch (locErr) {
        console.error(`[${id}:${slug}] FAILED: ${locErr.message}`);
        lastError = locErr.message;
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

module.exports = { parse };
