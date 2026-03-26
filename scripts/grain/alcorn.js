// scripts/grain/alcorn.js
// Al-Corn Clean Fuel — cash bid scraper
// Single location (Claremont MN), corn only.
// Widget type unknown — discovery parser that logs DOM structure,
// then attempts multiple selector strategies to find bid data.
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

// Normalize delivery label: "Mar 26" → "Mar26", "Mar 2026" → "Mar26"
function normDelivery(str) {
  if (!str) return null;
  const t = str.trim();
  // "Mar 2026" → "Mar26"
  const m1 = t.match(/^([A-Za-z]{3})\s*(\d{4})$/);
  if (m1) return m1[1] + m1[2].slice(2);
  // "Mar 26" → "Mar26"
  const m2 = t.match(/^([A-Za-z]{3})\s+(\d{2})$/);
  if (m2) return m2[1] + m2[2];
  // Already "Mar26"
  if (/^[A-Za-z]{3}\d{2}$/.test(t)) return t;
  return t;
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const url = config.url;
  const locations = {};

  console.log(`[${id}] navigating to ${url}`);
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Give JS widgets time to render
    await new Promise(r => setTimeout(r, 5000));

    // ── Phase 1: Discovery — log what's on the page ──────────────────────
    const discovery = await page.evaluate(() => {
      const info = {
        tables: [],
        iframes: [],
        widgets: [],
        selects: [],
        interestingDivs: [],
      };

      // Find all tables
      document.querySelectorAll('table').forEach((t, i) => {
        const rows = t.querySelectorAll('tr');
        const firstRowText = rows[0]?.textContent?.trim()?.substring(0, 200) || '';
        info.tables.push({
          index: i,
          id: t.id || null,
          className: t.className || null,
          rows: rows.length,
          firstRow: firstRowText,
        });
      });

      // Find iframes
      document.querySelectorAll('iframe').forEach(f => {
        info.iframes.push({ src: f.src || null, id: f.id || null, className: f.className || null });
      });

      // Find common widget containers
      const widgetSelectors = [
        '[data-cmdty-widget]', 'cmdty-cash-bids', '.cmdty-cash-bids',
        '#dtn-bids', '[id*="cashbid"]', '[class*="cashbid"]',
        '[id*="cash-bid"]', '[class*="cash-bid"]',
        '[data-widget]', '[id*="barchart"]', '[class*="barchart"]',
        '#cash-bids-combined-table',
      ];
      for (const sel of widgetSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          info.widgets.push({
            selector: sel,
            tagName: el.tagName,
            id: el.id || null,
            className: (el.className && typeof el.className === 'string') ? el.className.substring(0, 200) : null,
            childCount: el.children.length,
            innerSnippet: el.innerHTML.substring(0, 300),
          });
        }
      }

      // Find select elements
      document.querySelectorAll('select').forEach(s => {
        const opts = Array.from(s.options).map(o => o.textContent.trim()).slice(0, 5);
        info.selects.push({ id: s.id || null, className: s.className || null, optionCount: s.options.length, sampleOpts: opts });
      });

      // Find divs/elements that contain price-like text
      const allElements = document.querySelectorAll('div, section, article, main');
      for (const el of allElements) {
        const text = el.textContent || '';
        if (/\bCorn\b/i.test(text) && /\b(Delivery|Basis|Bid|Cash)\b/i.test(text) && el.children.length < 50) {
          info.interestingDivs.push({
            tagName: el.tagName,
            id: el.id || null,
            className: (el.className && typeof el.className === 'string') ? el.className.substring(0, 200) : null,
            childCount: el.children.length,
            textSnippet: text.substring(0, 300),
          });
        }
      }

      return info;
    });

    console.log(`[${id}] DISCOVERY:`);
    console.log(`[${id}]   tables: ${discovery.tables.length}`);
    discovery.tables.forEach(t => console.log(`[${id}]     table #${t.index}: id="${t.id}" class="${t.className}" rows=${t.rows} first="${t.firstRow}"`));
    console.log(`[${id}]   iframes: ${discovery.iframes.length}`);
    discovery.iframes.forEach(f => console.log(`[${id}]     iframe: src="${f.src}" id="${f.id}"`));
    console.log(`[${id}]   widgets: ${discovery.widgets.length}`);
    discovery.widgets.forEach(w => console.log(`[${id}]     widget: sel="${w.selector}" tag=${w.tagName} id="${w.id}" children=${w.childCount} snippet="${w.innerSnippet}"`));
    console.log(`[${id}]   selects: ${discovery.selects.length}`);
    discovery.selects.forEach(s => console.log(`[${id}]     select: id="${s.id}" opts=${s.optionCount} sample=${JSON.stringify(s.sampleOpts)}`));
    console.log(`[${id}]   interesting divs: ${discovery.interestingDivs.length}`);
    discovery.interestingDivs.forEach(d => console.log(`[${id}]     div: tag=${d.tagName} id="${d.id}" class="${d.className}" children=${d.childCount} text="${d.textSnippet}"`));

    // ── Phase 2: Try to parse data using discovered structure ─────────────

    // Strategy A: standard table with commodity sections
    if (discovery.tables.length > 0) {
      console.log(`[${id}] trying Strategy A: parse tables directly`);
      const bidData = await page.evaluate(() => {
        const result = {};
        let currentCommodity = null;
        let colMap = null;

        // Try all tables on the page
        const tables = document.querySelectorAll('table');
        for (const table of tables) {
          const allRows = table.querySelectorAll('tr');

          for (const row of allRows) {
            const cells = row.querySelectorAll('td, th');
            const text = row.textContent.trim().toUpperCase();

            // Detect commodity header — could be a row with just "CORN" text
            if (/^CORN\s*[\^v]?\s*$/.test(text) || text === 'CORN') {
              currentCommodity = 'corn';
              result.corn = result.corn || [];
              colMap = null;
              continue;
            }
            if (/^SOYBEANS?\s*[\^v]?\s*$/.test(text) || text === 'BEANS') {
              currentCommodity = 'beans';
              result.beans = result.beans || [];
              colMap = null;
              continue;
            }

            // Detect column headers
            if (currentCommodity && !colMap && cells.length >= 4) {
              const headers = Array.from(cells).map(c => c.textContent.trim().toUpperCase());
              if (headers.some(h => /DELIVER/i.test(h) || /^DEL$/i.test(h))) {
                colMap = {};
                headers.forEach((h, i) => {
                  if (/DELIVER/i.test(h) || /^DEL$/i.test(h)) colMap.delivery = i;
                  if (/^FUTURES$/i.test(h)) colMap.futuresMonth = i;
                  if (/^BASIS$/i.test(h)) colMap.basis = i;
                  if (/^BID$/i.test(h)) colMap.cash = i;
                  if (/^CASH/i.test(h)) colMap.cash = i;
                  if (/CHANGE/i.test(h) || /^CHG$/i.test(h)) colMap.change = i;
                  if (/^CBOT$/i.test(h)) colMap.cbot = i;
                });
                continue;
              }
            }

            // Parse data rows
            if (currentCommodity && colMap && cells.length >= 4) {
              const get = (idx) => idx != null && cells[idx] ? cells[idx].textContent.trim() : null;
              const delivery = get(colMap.delivery);

              if (delivery && /^[A-Za-z]{3}\s?\d{2}/i.test(delivery)) {
                const row_data = {
                  del: delivery.replace(/\s+/g, ''),
                  cash: get(colMap.cash),
                  basis: get(colMap.basis),
                };
                if (colMap.futuresMonth != null) row_data.month = get(colMap.futuresMonth);
                if (colMap.change != null) row_data.chg = get(colMap.change);
                if (colMap.cbot != null) row_data.cbot = get(colMap.cbot);
                result[currentCommodity].push(row_data);
              }
            }
          }
        }

        return Object.keys(result).length > 0 ? result : null;
      });

      if (bidData) {
        console.log(`[${id}] Strategy A succeeded`);
        return buildResult(id, bidData, locations);
      }
      console.log(`[${id}] Strategy A: no data found`);
    }

    // Strategy B: iframe — navigate into it
    if (discovery.iframes.length > 0) {
      console.log(`[${id}] trying Strategy B: check iframes`);
      for (const frameInfo of discovery.iframes) {
        if (!frameInfo.src) continue;
        console.log(`[${id}]   checking iframe: ${frameInfo.src}`);

        const frames = page.frames();
        for (const frame of frames) {
          if (!frame.url().includes(frameInfo.src?.substring(0, 30))) continue;

          const iframeBidData = await frame.evaluate(() => {
            const result = {};
            let currentCommodity = null;
            let colMap = null;
            const tables = document.querySelectorAll('table');

            for (const table of tables) {
              for (const row of table.querySelectorAll('tr')) {
                const cells = row.querySelectorAll('td, th');
                const text = row.textContent.trim().toUpperCase();

                if (/^CORN/.test(text) && cells.length <= 2) {
                  currentCommodity = 'corn';
                  result.corn = result.corn || [];
                  colMap = null;
                  continue;
                }
                if (/^SOYBEAN/.test(text) && cells.length <= 2) {
                  currentCommodity = 'beans';
                  result.beans = result.beans || [];
                  colMap = null;
                  continue;
                }

                if (currentCommodity && !colMap && cells.length >= 4) {
                  const headers = Array.from(cells).map(c => c.textContent.trim().toUpperCase());
                  if (headers.some(h => /DELIVER/i.test(h))) {
                    colMap = {};
                    headers.forEach((h, i) => {
                      if (/DELIVER/i.test(h)) colMap.delivery = i;
                      if (/^FUTURES$/i.test(h)) colMap.futuresMonth = i;
                      if (/^BASIS$/i.test(h)) colMap.basis = i;
                      if (/^BID$/i.test(h) || /^CASH/i.test(h)) colMap.cash = i;
                      if (/CHANGE/i.test(h)) colMap.change = i;
                    });
                    continue;
                  }
                }

                if (currentCommodity && colMap && cells.length >= 4) {
                  const get = (idx) => idx != null && cells[idx] ? cells[idx].textContent.trim() : null;
                  const delivery = get(colMap.delivery);
                  if (delivery && /^[A-Za-z]{3}\s?\d{2}/i.test(delivery)) {
                    const row_data = {
                      del: delivery.replace(/\s+/g, ''),
                      cash: get(colMap.cash),
                      basis: get(colMap.basis),
                    };
                    if (colMap.futuresMonth != null) row_data.month = get(colMap.futuresMonth);
                    if (colMap.change != null) row_data.chg = get(colMap.change);
                    result[currentCommodity].push(row_data);
                  }
                }
              }
            }

            return Object.keys(result).length > 0 ? result : null;
          }).catch(() => null);

          if (iframeBidData) {
            console.log(`[${id}] Strategy B succeeded (iframe)`);
            return buildResult(id, iframeBidData, locations);
          }
        }
      }
      console.log(`[${id}] Strategy B: no data in iframes`);
    }

    // Strategy C: cmdty web component — shadow DOM
    const cmdtyData = await page.evaluate(() => {
      const widget = document.querySelector('cmdty-cash-bids');
      if (!widget) return null;

      const root = widget.shadowRoot || widget;
      const result = {};
      let currentCommodity = null;
      let colMap = null;

      for (const table of root.querySelectorAll('table')) {
        for (const row of table.querySelectorAll('tr')) {
          const cells = row.querySelectorAll('td, th');
          const text = row.textContent.trim().toUpperCase();

          if (/^CORN/.test(text) && cells.length <= 2) {
            currentCommodity = 'corn'; result.corn = []; colMap = null; continue;
          }
          if (/^SOYBEAN/.test(text) && cells.length <= 2) {
            currentCommodity = 'beans'; result.beans = []; colMap = null; continue;
          }

          if (currentCommodity && !colMap && cells.length >= 4) {
            const headers = Array.from(cells).map(c => c.textContent.trim().toUpperCase());
            if (headers.some(h => /DELIVER/i.test(h))) {
              colMap = {};
              headers.forEach((h, i) => {
                if (/DELIVER/i.test(h)) colMap.delivery = i;
                if (/^FUTURES$/i.test(h)) colMap.futuresMonth = i;
                if (/^BASIS$/i.test(h)) colMap.basis = i;
                if (/^BID$/i.test(h) || /^CASH/i.test(h)) colMap.cash = i;
                if (/CHANGE/i.test(h)) colMap.change = i;
              });
              continue;
            }
          }

          if (currentCommodity && colMap && cells.length >= 4) {
            const get = (idx) => idx != null && cells[idx] ? cells[idx].textContent.trim() : null;
            const delivery = get(colMap.delivery);
            if (delivery && /^[A-Za-z]{3}\s?\d{2}/i.test(delivery)) {
              const row_data = { del: delivery.replace(/\s+/g, ''), cash: get(colMap.cash), basis: get(colMap.basis) };
              if (colMap.futuresMonth != null) row_data.month = get(colMap.futuresMonth);
              if (colMap.change != null) row_data.chg = get(colMap.change);
              result[currentCommodity].push(row_data);
            }
          }
        }
      }

      return Object.keys(result).length > 0 ? result : null;
    });

    if (cmdtyData) {
      console.log(`[${id}] Strategy C succeeded (cmdty web component)`);
      return buildResult(id, cmdtyData, locations);
    }

    // Strategy D: full page text scrape — last resort
    console.log(`[${id}] trying Strategy D: full page text scan for price patterns`);
    const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 5000) || '');
    console.log(`[${id}] page text (first 2000): ${pageText.substring(0, 2000)}`);

    console.warn(`[${id}] all strategies failed — no bid data found`);
    return { locations: {}, source: 'fetch_failed', error: 'widget structure not recognized — see discovery logs' };

  } catch (err) {
    console.error(`[${id}] PAGE LOAD FAILED: ${err.message}`);
    return { locations: {}, source: 'fetch_failed', error: err.message };
  } finally {
    await page.close();
  }
}

// ── Build result from parsed bid data ────────────────────────────────────────

function buildResult(id, bidData, locations) {
  const parsed = {};
  for (const [commodity, rows] of Object.entries(bidData)) {
    parsed[commodity] = rows.map(r => {
      const entry = {
        delivery: normDelivery(r.del),
        cash:     parseCash(r.cash),
        basis:    parseBasis(r.basis),
      };
      if (r.month) entry.futuresMonth = r.month.replace(/\s+/g, '');
      if (r.chg)   entry.change = r.chg;
      if (r.cbot)  entry.cbot = r.cbot;
      return entry;
    }).filter(r => r.cash !== null);
  }

  const slug = 'claremont';
  locations[slug] = { name: 'Al-Corn', ...parsed };

  const cornCount = parsed.corn?.length || 0;
  const beanCount = parsed.beans?.length || 0;
  console.log(`[${id}:${slug}] parsed — corn: ${cornCount} bids, beans: ${beanCount} bids`);
  if (cornCount > 0) {
    console.log(`[${id}:${slug}]   corn nearby: $${parsed.corn[0].cash} basis ${parsed.corn[0].basis} (${parsed.corn[0].delivery})`);
  }

  return { locations, source: 'scraped', error: null };
}

module.exports = { parse };
