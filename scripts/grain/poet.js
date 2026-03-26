// scripts/grain/poet.js
// POET Biorefining — cash bid scraper via Gradable platform
// Locations: Bingham Lake MN (corn+beans), Albert Lea MN (corn only)
// Gradable is a React SPA — no standard <table> elements, uses div-based layout.
// Corn:  https://poet.gradable.com/market/{Location}--MN?commodity=CN
// Beans: https://poet.gradable.com/market/{Location}--MN?commodity=SB
// robots.txt: Allow / (permissive)
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

// Normalize delivery: "Mar 26" → "Mar26"
function normDelivery(str) {
  if (!str) return null;
  const t = str.trim().split('\n')[0].trim();
  const m1 = t.match(/^([A-Za-z]{3})\s*(\d{4})$/);
  if (m1) return m1[1] + m1[2].slice(2);
  const m2 = t.match(/^([A-Za-z]{3})\s+(\d{2})$/);
  if (m2) return m2[1] + m2[2];
  if (/^[A-Za-z]{3}\d{2}$/.test(t)) return t;
  return t;
}

// ── Location config ─────────────────────────────────────────────────────────

const LOCATIONS = [
  { slug: 'bingham-lake', name: 'Bingham Lake', urlPath: 'Bingham-Lake--MN', commodities: ['CN', 'SB'] },
  { slug: 'albert-lea',   name: 'Albert Lea',   urlPath: 'Albert-Lea--MN',   commodities: ['CN'] },
];

const COMMODITY_MAP = { CN: 'corn', SB: 'beans' };

// ── Scrape one commodity page ───────────────────────────────────────────────

async function scrapeCommodity(id, browser, url, commodityName) {
  const page = await browser.newPage();
  const bids = [];

  try {
    console.log(`[${id}] navigating to ${url} (${commodityName})`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Give React time to render
    await new Promise(r => setTimeout(r, 5000));

    // Discovery: find what elements contain bid data
    const discovery = await page.evaluate(() => {
      const info = {
        tables: document.querySelectorAll('table').length,
        bodyText: '',
        rowElements: [],
      };

      // Look for elements that contain price-like text patterns
      const body = document.body?.innerText || '';
      info.bodyText = body.substring(0, 3000);

      // Find all elements containing "Delivery" header text
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        if (el.children.length > 0) continue; // leaf nodes only
        const text = el.textContent.trim();
        if (text === 'Delivery' || text === 'Cash' || text === 'Basis' || text === 'Option Month') {
          info.rowElements.push({
            tag: el.tagName,
            class: el.className?.substring?.(0, 100) || '',
            parent: el.parentElement?.tagName || '',
            parentClass: el.parentElement?.className?.substring?.(0, 100) || '',
            grandparent: el.parentElement?.parentElement?.tagName || '',
            gpClass: el.parentElement?.parentElement?.className?.substring?.(0, 100) || '',
          });
        }
      }

      return info;
    });

    console.log(`[${id}] ${commodityName} discovery: tables=${discovery.tables}`);
    console.log(`[${id}] ${commodityName} header elements found: ${discovery.rowElements.length}`);
    discovery.rowElements.forEach(r => console.log(`[${id}]   ${r.tag}.${r.class} in ${r.parent}.${r.parentClass} in ${r.grandparent}.${r.gpClass}`));

    // Strategy: extract bid data from page text using patterns
    // Gradable shows: "Mar 26\n3/1/26 – 3/31/26\nZCK6\n$4.13\n-$0.55\n468'2\n+1'0"
    const bidRows = await page.evaluate(() => {
      const results = [];

      // Strategy A: look for table elements (standard HTML)
      const tables = document.querySelectorAll('table');
      if (tables.length > 0) {
        for (const table of tables) {
          const headerRow = table.querySelector('thead tr');
          if (!headerRow) continue;
          const headers = Array.from(headerRow.querySelectorAll('th'))
            .map(th => th.textContent.trim().toUpperCase());

          const colMap = {};
          headers.forEach((h, i) => {
            if (/DELIVER/i.test(h)) colMap.delivery = i;
            if (/OPTION/i.test(h)) colMap.optionMonth = i;
            if (/CASH/i.test(h)) colMap.cash = i;
            if (/BASIS/i.test(h)) colMap.basis = i;
            if (/^FUTURES$/i.test(h) && !('futures' in colMap)) colMap.futures = i;
            if (/FUTURES.*CHANGE/i.test(h)) colMap.change = i;
          });

          if (colMap.delivery == null || colMap.cash == null) continue;

          for (const row of table.querySelectorAll('tbody tr')) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 3) continue;
            const get = (idx) => idx != null && cells[idx] ? cells[idx].textContent.trim() : null;
            const del = get(colMap.delivery);
            if (del && /[A-Za-z]{3}\s?\d{2}/i.test(del.split('\n')[0])) {
              results.push({
                del: del, optionMonth: get(colMap.optionMonth),
                cash: get(colMap.cash), basis: get(colMap.basis),
                futures: get(colMap.futures), change: get(colMap.change),
              });
            }
          }
          if (results.length > 0) return results;
        }
      }

      // Strategy B: find row-like div structures
      // Look for repeated sibling elements that each contain delivery month patterns
      const allText = document.body.innerText || '';
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monthPattern = new RegExp(`(${months.join('|')})\\s+(\\d{2})`, 'g');

      // Find clickable/visible rows — Gradable uses role="row" or similar
      const rowCandidates = document.querySelectorAll('[role="row"], tr, [class*="row"], [class*="Row"]');
      for (const row of rowCandidates) {
        const text = row.textContent.trim();
        const m = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})/);
        if (!m) continue;

        // Try to extract structured data from the row
        const cells = row.querySelectorAll('[role="cell"], td, [class*="cell"], [class*="Cell"]');
        if (cells.length >= 3) {
          const vals = Array.from(cells).map(c => c.textContent.trim());
          results.push({
            del: vals[0] || null,
            optionMonth: vals[1] || null,
            cash: vals[2] || null,
            basis: vals[3] || null,
            futures: vals[4] || null,
            change: vals[5] || null,
          });
          continue;
        }

        // Fallback: split text by newlines or whitespace patterns
        const parts = text.split('\n').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 3) {
          results.push({
            del: parts[0] || null,
            optionMonth: parts.find(p => /^ZC|^ZS/i.test(p)) || null,
            cash: parts.find(p => /^\$?\d+\.\d{2}$/.test(p)) || null,
            basis: parts.find(p => /^-?\$?\d+\.\d{2}$/.test(p) && p !== parts.find(q => /^\$?\d+\.\d{2}$/.test(q))) || null,
            futures: parts.find(p => /^\d{3}'\d/.test(p)) || null,
            change: parts.find(p => /^[+-]\d+'\d/.test(p)) || null,
          });
        }
      }

      if (results.length > 0) return results;

      // Strategy C: regex parse the full page text
      // Pattern: "Mar 26\n3/1/26 – 3/31/26\nZCK6\n$4.13\n-$0.55\n468'2\n+1'0"
      const lines = allText.split('\n').map(s => s.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const delMatch = line.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2})$/);
        if (!delMatch) continue;

        // Look ahead for data in subsequent lines
        const ahead = lines.slice(i + 1, i + 8);
        const optMonth = ahead.find(l => /^ZC|^ZS/i.test(l)) || null;
        const cashLine = ahead.find(l => /^\$\d+\.\d{2}$/.test(l));
        const basisLine = ahead.find(l => /^-?\$\d+\.\d{2}$/.test(l) && l !== cashLine);
        const futuresLine = ahead.find(l => /^\d{3}'\d/.test(l)) || null;
        const changeLine = ahead.find(l => /^[+-]\d+'\d/.test(l)) || null;

        if (cashLine) {
          results.push({
            del: line,
            optionMonth: optMonth,
            cash: cashLine,
            basis: basisLine || null,
            futures: futuresLine,
            change: changeLine,
          });
        }
      }

      return results;
    });

    console.log(`[${id}] ${commodityName}: ${bidRows.length} bids found`);
    if (bidRows.length > 0) {
      console.log(`[${id}]   first row: ${JSON.stringify(bidRows[0])}`);
    } else {
      // Log page text for debugging
      const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');
      console.log(`[${id}] ${commodityName} page text (first 1500): ${pageText.substring(0, 1500)}`);
    }

    for (const r of bidRows) {
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
  const baseUrl = 'https://poet.gradable.com/market';

  for (const loc of LOCATIONS) {
    console.log(`\n[${id}] === ${loc.name} (${loc.slug}) ===`);
    const locData = { name: loc.name };

    for (const commodity of loc.commodities) {
      const comName = COMMODITY_MAP[commodity];
      const url = `${baseUrl}/${loc.urlPath}?commodity=${commodity}`;
      const bids = await scrapeCommodity(id, browser, url, comName);

      if (bids.length > 0) {
        locData[comName] = bids;
      }
    }

    if (locData.corn?.length > 0 || locData.beans?.length > 0) {
      locations[loc.slug] = locData;
      console.log(`[${id}:${loc.slug}] captured — corn: ${locData.corn?.length || 0}, beans: ${locData.beans?.length || 0}`);
    } else {
      console.log(`[${id}:${loc.slug}] no data captured`);
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
