// scripts/grain/jennieo.js
// Jennie-O Turkey Store — corn cash bid scraper
// Parses the AgHost portal at jennieo.aghostportal.com.
// Each location has its own URL via theLocation=N parameter.
// The page uses displayNumber() with document.write() to render prices
// into a <table class="DataGrid">.
// Columns: Delivery End Date | Cash Price | Basis | Futures Price | Futures Month | Chart
// Corn only — no soybeans on this site.
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

// Convert "8/31/26" → "Aug26"
function deliveryLabel(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2})\/\d{1,2}\/(\d{2,4})$/);
  if (m) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = parseInt(m[1], 10) - 1;
    const yr = m[2].length === 4 ? m[2].slice(2) : m[2];
    return months[mon] + yr;
  }
  return str.trim();
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const locations = {};
  let lastError = null;
  const page = await browser.newPage();
  const baseUrl = config.url;

  try {
    for (const loc of config.locations) {
      const locUrl = `${baseUrl}&theLocation=${loc.locId}`;
      const slug = slugify(loc.name);
      console.log(`\n[${id}:${slug}] loading: ${locUrl}`);

      try {
        await page.goto(locUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        // Read the rendered DataGrid table — displayNumber() uses document.write()
        // so values are in the DOM after page load
        const bids = await page.evaluate(() => {
          const table = document.querySelector('table.DataGrid');
          if (!table) return [];

          const results = [];
          const rows = table.querySelectorAll('tbody tr, tr');

          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 5) continue;

            const delivery    = (cells[0]?.textContent || '').trim();
            const cash        = (cells[1]?.textContent || '').trim();
            const basis       = (cells[2]?.textContent || '').trim();
            const futuresPrice = (cells[3]?.textContent || '').trim();
            const futuresMonth = (cells[4]?.textContent || '').trim();

            // Skip header-like rows
            if (/delivery/i.test(delivery)) continue;
            // Validate: delivery should look like a date
            if (!/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(delivery)) continue;

            results.push({ delivery, cash, basis, futuresPrice, futuresMonth });
          }
          return results;
        });

        console.log(`[${id}:${slug}] found ${bids.length} bid rows`);

        if (bids.length === 0) {
          const info = await page.evaluate(() => {
            const table = document.querySelector('table.DataGrid');
            const rows = table ? table.querySelectorAll('tr') : [];
            const sample = [];
            for (let i = 0; i < Math.min(rows.length, 3); i++) {
              const cells = rows[i].querySelectorAll('td, th');
              sample.push({
                cellCount: cells.length,
                texts: Array.from(cells).slice(0, 5).map(c => c.textContent.trim().substring(0, 40)),
                htmls: Array.from(cells).slice(0, 2).map(c => c.innerHTML.substring(0, 80)),
              });
            }
            return {
              title: document.title,
              tableCount: document.querySelectorAll('table').length,
              dataGridCount: document.querySelectorAll('table.DataGrid').length,
              bodyLength: document.body?.innerHTML?.length || 0,
              rowCount: rows.length,
              sampleRows: sample,
            };
          });
          console.warn(`[${id}:${slug}] no bids found — page info: ${JSON.stringify(info)}`);
          continue;
        }

        locations[slug] = { name: loc.name, corn: [], beans: [] };

        for (const bid of bids) {
          const entry = {
            delivery:     deliveryLabel(bid.delivery),
            cash:         parseCash(bid.cash),
            futuresMonth: bid.futuresMonth || null,
            basis:        parseBasis(bid.basis),
            change:       null,
            cbot:         bid.futuresPrice || null,
          };

          if (entry.cash !== null && entry.delivery) {
            locations[slug].corn.push(entry);
          }
        }

        const cornCount = locations[slug].corn.length;
        console.log(`[${id}:${slug}] parsed — corn: ${cornCount} bids`);
        if (cornCount > 0) {
          console.log(`[${id}:${slug}]   corn nearby: $${locations[slug].corn[0].cash} basis ${locations[slug].corn[0].basis} (${locations[slug].corn[0].delivery})`);
        }

      } catch (locErr) {
        console.error(`[${id}:${slug}] FAILED: ${locErr.message}`);
        lastError = locErr.message;
      }
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
