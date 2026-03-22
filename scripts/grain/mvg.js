// scripts/grain/mvg.js
// Minnesota Valley Grain — cash bid scraper
// Parses the Barchart-powered cash bid page on mnvalleygrain.com.
// The page uses document.write() via writeBidRow() to render table rows.
// We use page.evaluate() on the live DOM rather than cheerio on page.content()
// because document.write() output may not serialize reliably.
// The site supports a location_filter URL param, so we load each location separately.
// Columns: Name | Delivery Start | Delivery End | Futures Month | Futures Price | Change | Basis | Cash Price | Settlement
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
  if (isNaN(val)) return null;
  // Basis on this site is displayed as a decimal (e.g. -0.63)
  // but writeBidRow receives it in cents (-63) and converts internally.
  // The rendered cell shows the decimal form.
  return val;
}

// Convert delivery date "03/01/2026" → "Mar26"
function deliveryLabel(startStr) {
  if (!startStr) return null;
  const m = startStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = parseInt(m[1], 10) - 1;
    const yr = m[3].slice(2);
    return months[mon] + yr;
  }
  const iso = startStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = parseInt(iso[2], 10) - 1;
    const yr = iso[1].slice(2);
    return months[mon] + yr;
  }
  return startStr;
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const locations = {};
  let lastError = null;
  const page = await browser.newPage();
  const baseUrl = config.url.split('?')[0];

  try {
    for (const loc of config.locations) {
      const locUrl = `${baseUrl}?location_filter=${encodeURIComponent(loc.name)}&showcwt=0`;
      const slug = slugify(loc.name);
      console.log(`\n[${id}:${slug}] loading: ${locUrl}`);

      try {
        await page.goto(locUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        // Read the rendered DOM directly — writeBidRow() uses document.write()
        // to create <tr> elements with 9 <td> cells each.
        const bids = await page.evaluate(() => {
          const result = [];
          const rows = document.querySelectorAll('tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 8) continue;
            const name = (cells[0]?.textContent || '').trim().toUpperCase();
            if (name !== 'CORN' && name !== 'SOYBEANS') continue;
            result.push({
              commodity:    name === 'SOYBEANS' ? 'beans' : 'corn',
              deliveryStart: (cells[1]?.textContent || '').trim(),
              futuresMonth: (cells[3]?.textContent || '').trim(),
              futuresPrice: (cells[4]?.textContent || '').trim(),
              change:       (cells[5]?.textContent || '').trim(),
              basis:        (cells[6]?.textContent || '').trim(),
              cash:         (cells[7]?.textContent || '').trim(),
            });
          }
          return result;
        });

        console.log(`[${id}:${slug}] found ${bids.length} bid rows`);

        if (bids.length === 0) {
          // Log page info for debugging
          const info = await page.evaluate(() => {
            return {
              title: document.title,
              tableCount: document.querySelectorAll('table').length,
              trCount: document.querySelectorAll('tr').length,
              bodyLength: document.body?.innerHTML?.length || 0,
            };
          });
          console.warn(`[${id}:${slug}] no bids found — page info: ${JSON.stringify(info)}`);
          continue;
        }

        locations[slug] = { name: loc.name, corn: [], beans: [] };

        for (const bid of bids) {
          const entry = {
            delivery:     deliveryLabel(bid.deliveryStart),
            cash:         parseCash(bid.cash),
            futuresMonth: bid.futuresMonth || null,
            basis:        parseBasis(bid.basis),
            change:       bid.change || null,
            cbot:         bid.futuresPrice || null,
          };

          if (entry.cash !== null && entry.delivery) {
            locations[slug][bid.commodity].push(entry);
          }
        }

        const cornCount = locations[slug].corn.length;
        const beanCount = locations[slug].beans.length;
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
