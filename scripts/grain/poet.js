// scripts/grain/poet.js
// POET Biorefining — cash bid scraper via Gradable platform
// Location: Bingham Lake MN. Corn + soybeans on separate URLs.
// Gradable is a React SPA — requires Puppeteer for rendering.
// Corn:  https://poet.gradable.com/market/Bingham-Lake--MN?commodity=CN
// Beans: https://poet.gradable.com/market/Bingham-Lake--MN?commodity=SB
// Table columns: Delivery | Option Month | Cash (USD/bu) | Basis (USD/bu) | Futures | Futures Change
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
  const t = str.trim().split('\n')[0].trim(); // take first line (ignore date range)
  const m1 = t.match(/^([A-Za-z]{3})\s*(\d{4})$/);
  if (m1) return m1[1] + m1[2].slice(2);
  const m2 = t.match(/^([A-Za-z]{3})\s+(\d{2})$/);
  if (m2) return m2[1] + m2[2];
  if (/^[A-Za-z]{3}\d{2}$/.test(t)) return t;
  return t;
}

// ── Scrape one commodity page ───────────────────────────────────────────────

async function scrapeCommodity(id, browser, url, commodityName) {
  const page = await browser.newPage();
  const bids = [];

  try {
    console.log(`[${id}] navigating to ${url} (${commodityName})`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for the table to render — Gradable is a React app
    await page.waitForSelector('table', { timeout: 15000 }).catch(() => {
      console.warn(`[${id}] no <table> found for ${commodityName} — trying anyway`);
    });

    // Extra settle time for React hydration
    await new Promise(r => setTimeout(r, 3000));

    // Parse the bids table
    const rows = await page.evaluate(() => {
      const results = [];
      const tables = document.querySelectorAll('table');
      if (tables.length === 0) return results;

      for (const table of tables) {
        // Find column headers
        const headerRow = table.querySelector('thead tr');
        if (!headerRow) continue;

        const headers = Array.from(headerRow.querySelectorAll('th'))
          .map(th => th.textContent.trim().toUpperCase());

        // Map columns
        const colMap = {};
        headers.forEach((h, i) => {
          if (/DELIVER/i.test(h))                          colMap.delivery = i;
          if (/OPTION\s*MONTH/i.test(h))                   colMap.optionMonth = i;
          if (/CASH/i.test(h))                             colMap.cash = i;
          if (/BASIS/i.test(h))                            colMap.basis = i;
          if (/^FUTURES$/i.test(h) && !('futures' in colMap)) colMap.futures = i;
          if (/FUTURES\s*CHANGE/i.test(h))                 colMap.change = i;
        });

        if (colMap.delivery == null || colMap.cash == null) continue;

        // Parse data rows
        const dataRows = table.querySelectorAll('tbody tr');
        for (const row of dataRows) {
          const cells = row.querySelectorAll('td');
          if (cells.length < 3) continue;

          const get = (idx) => idx != null && cells[idx] ? cells[idx].textContent.trim() : null;

          const delivery = get(colMap.delivery);
          if (!delivery || !/^[A-Za-z]{3}\s?\d{2}/i.test(delivery.split('\n')[0].trim())) continue;

          results.push({
            del: delivery,
            optionMonth: get(colMap.optionMonth),
            cash: get(colMap.cash),
            basis: get(colMap.basis),
            futures: get(colMap.futures),
            change: get(colMap.change),
          });
        }

        // Use first table with data
        if (results.length > 0) break;
      }

      return results;
    });

    console.log(`[${id}] ${commodityName}: ${rows.length} bids found`);
    if (rows.length > 0) {
      console.log(`[${id}]   first row: ${JSON.stringify(rows[0])}`);
    }

    for (const r of rows) {
      const entry = {
        delivery:     normDelivery(r.del),
        cash:         parseCash(r.cash),
        basis:        parseBasis(r.basis),
      };
      if (r.optionMonth) entry.futuresMonth = r.optionMonth.trim();
      if (r.futures)     entry.cbot = r.futures.trim();
      if (r.change)      entry.change = r.change.trim();
      if (entry.cash !== null) bids.push(entry);
    }

  } catch (err) {
    console.error(`[${id}] ${commodityName} FAILED: ${err.message}`);
  } finally {
    await page.close();
  }

  return bids;
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const locations = {};
  const baseUrl = 'https://poet.gradable.com/market/Bingham-Lake--MN';

  // Scrape corn and soybeans from separate URLs
  const corn  = await scrapeCommodity(id, browser, `${baseUrl}?commodity=CN`, 'corn');
  const beans = await scrapeCommodity(id, browser, `${baseUrl}?commodity=SB`, 'soybeans');

  const slug = 'bingham-lake';
  if (corn.length > 0 || beans.length > 0) {
    locations[slug] = { name: 'Bingham Lake' };
    if (corn.length > 0)  locations[slug].corn = corn;
    if (beans.length > 0) locations[slug].beans = beans;

    console.log(`[${id}:${slug}] parsed — corn: ${corn.length} bids, beans: ${beans.length} bids`);
    if (corn.length > 0) {
      console.log(`[${id}:${slug}]   corn nearby: $${corn[0].cash} basis ${corn[0].basis} (${corn[0].delivery})`);
    }
    if (beans.length > 0) {
      console.log(`[${id}:${slug}]   beans nearby: $${beans[0].cash} basis ${beans[0].basis} (${beans[0].delivery})`);
    }
  }

  const locCount = Object.keys(locations).length;
  console.log(`\n[${id}] scrape complete — ${locCount} locations captured`);

  if (locCount === 0) {
    return { locations, source: 'fetch_failed', error: 'no bids found on Gradable' };
  }

  return { locations, source: 'scraped', error: null };
}

module.exports = { parse };
