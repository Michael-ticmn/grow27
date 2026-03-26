// scripts/grain/alcorn.js
// Al-Corn Clean Fuel — cash bid scraper
// Single location (Claremont MN), corn only.
// Uses a CIH (Commodity Information Hub) widget — not DTN.
// Widget structure: table.cih-table inside div.cih-loc-card containers.
// Select#cih-location-filter for filtering locations.
// Columns: Delivery | Futures (month + price in same cell) | Change | Basis | Bid (cash)
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
  const t = str.trim();
  const m1 = t.match(/^([A-Za-z]{3})\s*(\d{4})$/);
  if (m1) return m1[1] + m1[2].slice(2);
  const m2 = t.match(/^([A-Za-z]{3})\s+(\d{2})$/);
  if (m2) return m2[1] + m2[2];
  if (/^[A-Za-z]{3}\d{2}$/.test(t)) return t;
  return t;
}

// Split CIH futures cell: "May 26\n \n 4.6550" → { month: "May26", price: "4.6550" }
function parseFuturesCell(str) {
  if (!str) return { month: null, price: null };
  // Split on newlines and filter empty
  const parts = str.split(/\n/).map(s => s.trim()).filter(Boolean);
  let month = null;
  let price = null;
  for (const p of parts) {
    if (/^[A-Za-z]{3}\s?\d{2,4}$/.test(p)) {
      month = normDelivery(p);
    } else if (/^\d+\.\d+/.test(p)) {
      price = p;
    }
  }
  return { month, price };
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const url = config.url;
  const locations = {};

  console.log(`[${id}] navigating to ${url}`);
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Wait for CIH widget to render
    await page.waitForSelector('table.cih-table', { timeout: 15000 });
    console.log(`[${id}] CIH widget found`);

    // Extra settle time
    await new Promise(r => setTimeout(r, 2000));

    // Use the location filter to isolate Al-Corn data
    // select#cih-location-filter has options: "Location", "", "Al-Corn", "HCP"
    const filterResult = await page.evaluate(() => {
      const select = document.querySelector('#cih-location-filter');
      if (!select) return { filtered: false, options: [] };

      const options = Array.from(select.options).map(o => ({
        value: o.value, text: o.textContent.trim()
      }));

      // Find the Al-Corn option
      const alcornOpt = options.find(o => /al.?corn/i.test(o.text));
      if (alcornOpt) {
        select.value = alcornOpt.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return { filtered: true, options, selected: alcornOpt.text };
      }

      return { filtered: false, options };
    });

    console.log(`[${id}] location filter: ${JSON.stringify(filterResult)}`);

    if (filterResult.filtered) {
      // Wait for filter to take effect
      await new Promise(r => setTimeout(r, 2000));
    }

    // Parse all visible location cards
    const bidData = await page.evaluate(() => {
      const allCards = [];

      const cards = document.querySelectorAll('.cih-loc-card');
      if (cards.length > 0) {
        for (const card of cards) {
          // Check if card is hidden (filtered out)
          const style = window.getComputedStyle(card);
          if (style.display === 'none' || style.visibility === 'hidden') continue;

          // Try every possible way to get the location name from the card
          const nameEl = card.querySelector('.cih-loc-name, .cih-name, [class*="loc-name"], [class*="location-name"]');
          let locName = nameEl ? nameEl.textContent.trim() : null;

          if (!locName) {
            // Try the first non-table child that has text
            for (const child of card.children) {
              if (child.tagName === 'TABLE') continue;
              const text = child.textContent.trim();
              if (text && text.length < 50 && !/Delivery|Futures|Basis/i.test(text)) {
                locName = text;
                break;
              }
            }
          }

          // Get all text content of the card for debugging
          const cardText = card.textContent.substring(0, 200);

          const table = card.querySelector('table.cih-table');
          if (!table) continue;

          allCards.push({
            locName,
            cardText,
            rows: parseTableRows(table),
          });
        }
      } else {
        // No cards — parse tables directly
        const tables = document.querySelectorAll('table.cih-table');
        for (let i = 0; i < tables.length; i++) {
          allCards.push({
            locName: `table-${i}`,
            cardText: '',
            rows: parseTableRows(tables[i]),
          });
        }
      }

      return allCards;

      function parseTableRows(table) {
        const rows = [];
        const allRows = table.querySelectorAll('tr');
        let colMap = null;

        for (const row of allRows) {
          const cells = row.querySelectorAll('td, th');
          if (cells.length < 4) continue;

          const headers = Array.from(cells).map(c => c.textContent.trim().toUpperCase());

          // Detect header row
          if (!colMap && headers.some(h => /DELIVER/i.test(h))) {
            colMap = {};
            headers.forEach((h, i) => {
              if (/DELIVER/i.test(h))   colMap.delivery = i;
              if (/^FUTURES$/i.test(h)) colMap.futures = i;
              if (/^BASIS$/i.test(h))   colMap.basis = i;
              if (/^BID$/i.test(h))     colMap.cash = i;
              if (/^CASH/i.test(h))     colMap.cash = i;
              if (/CHANGE/i.test(h))    colMap.change = i;
            });
            continue;
          }

          if (colMap && cells.length >= 4) {
            const get = (idx) => idx != null && cells[idx] ? cells[idx].textContent.trim() : null;
            const delivery = get(colMap.delivery);

            if (delivery && /^[A-Za-z]{3}\s?\d{2}/i.test(delivery)) {
              const entry = {
                del: delivery,
                cash: get(colMap.cash),
                basis: get(colMap.basis),
                futures: get(colMap.futures),  // raw: "May 26\n \n 4.6550"
              };
              if (colMap.change != null) entry.chg = get(colMap.change);
              rows.push(entry);
            }
          }
        }

        return rows;
      }
    });

    console.log(`[${id}] found ${bidData.length} cards`);
    bidData.forEach((c, i) => {
      console.log(`[${id}]   card ${i}: locName="${c.locName}" rows=${c.rows.length} cardText="${c.cardText.substring(0, 100)}"`);
      if (c.rows.length > 0) {
        console.log(`[${id}]     first row: ${JSON.stringify(c.rows[0])}`);
      }
    });

    // Use the first visible card (should be Al-Corn after filtering)
    // If filtering didn't work, take the first card that has reasonable corn prices
    let targetCard = bidData[0];
    if (bidData.length > 1) {
      // Prefer card named Al-Corn
      const alcornCard = bidData.find(c => c.locName && /al.?corn/i.test(c.locName));
      if (alcornCard) targetCard = alcornCard;
    }

    if (!targetCard || targetCard.rows.length === 0) {
      console.warn(`[${id}] no bid data found`);
      return { locations: {}, source: 'fetch_failed', error: 'no data in CIH tables' };
    }

    // Parse numeric values and split futures cell
    const corn = targetCard.rows.map(r => {
      const { month, price } = parseFuturesCell(r.futures);
      const entry = {
        delivery: normDelivery(r.del),
        cash:     parseCash(r.cash),
        basis:    parseBasis(r.basis),
      };
      if (month) entry.futuresMonth = month;
      if (price) entry.cbot = price;
      if (r.chg)  entry.change = r.chg;
      return entry;
    }).filter(r => r.cash !== null);

    const slug = 'claremont';
    locations[slug] = { name: 'Al-Corn', corn };

    console.log(`[${id}:${slug}] parsed — corn: ${corn.length} bids`);
    if (corn.length > 0) {
      console.log(`[${id}:${slug}]   corn nearby: $${corn[0].cash} basis ${corn[0].basis} (${corn[0].delivery}) futures=${corn[0].futuresMonth} cbot=${corn[0].cbot}`);
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
    return { locations, source: 'fetch_failed', error: 'no Al-Corn data found' };
  }

  return { locations, source: 'scraped', error: null };
}

module.exports = { parse };
