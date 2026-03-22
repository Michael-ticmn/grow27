// scripts/grain/mvg.js
// Minnesota Valley Grain — cash bid scraper
// Parses the Barchart-powered cash bid page on mnvalleygrain.com.
//
// The page uses writeBidRow() with document.write() to render table rows.
// However, in GitHub Actions, Barchart's quote JS often fails to load,
// so writeBidRow returns early and no DOM elements are created.
//
// Strategy:
//   1. Try rendered DOM first (works when quotes load)
//   2. Fall back to parsing writeBidRow() calls from page source HTML
//      + reading the quotes object from the page
//   3. Compute cash = (rawLast + basis) / 100 with rounding
//
// Columns from writeBidRow: Name | Del Start | Del End | Futures Month |
//   Futures Price | Change | Basis | Cash Price | Settlement
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

function slugify(name) {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
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
  return startStr;
}

// ── Parse writeBidRow() calls from source HTML ──────────────────────────────

function extractBidCalls(html) {
  // writeBidRow('CORN',-63,false,false,false,0.75,'03/01/2026','03/31/2026',
  //   'All','&nbsp;','&nbsp;',56,'odd','c=8397&l=37557&d=H26',quotes['ZCK26'], ...)
  const re = /writeBidRow\(\s*'(CORN|SOYBEANS)',\s*(-?\d+),\s*\w+,\s*\w+,\s*\w+,\s*([0-9.\-]+),\s*'(\d{2}\/\d{2}\/\d{4})',\s*'(\d{2}\/\d{2}\/\d{4})',\s*'[^']*',\s*'[^']*',\s*'[^']*',\s*\d+,\s*'\w+',\s*'([^']*)',\s*quotes\['([^']+)'\]/g;

  const calls = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    calls.push({
      commodity: match[1],
      basis:     parseInt(match[2], 10),
      rounding:  parseFloat(match[3]),
      delStart:  match[4],
      delEnd:    match[5],
      chartsym:  match[6],
      quoteKey:  match[7],
    });
  }
  return calls;
}

// Group bid calls by location. The chartsym contains l=<locId>.
// Calls appear in config-location order, so the first unique locId
// maps to config.locations[0], etc.
function groupByLocation(calls, config) {
  const seenIds = [];
  const byLocId = {};

  for (const bid of calls) {
    const m = bid.chartsym.match(/l=(\d+)/);
    const locId = m ? m[1] : 'unknown';
    if (!seenIds.includes(locId)) seenIds.push(locId);
    if (!byLocId[locId]) byLocId[locId] = [];
    byLocId[locId].push(bid);
  }

  const groups = {};
  for (let i = 0; i < seenIds.length && i < config.locations.length; i++) {
    const locId = seenIds[i];
    const locName = config.locations[i].name;
    const slug = slugify(locName);
    groups[slug] = { name: locName, bids: byLocId[locId] };
  }
  return groups;
}

// Compute cash price from Barchart rawLast + basis.
// Corn/beans futures (ZC/ZS) are in cents; cash = (rawLast + basis) / 100.
function computeCash(bid, quote) {
  if (!quote || quote.rawLast == null) return null;
  const rawCash = quote.rawLast + bid.basis;
  if (bid.rounding > -1) {
    const remainder = rawCash - Math.floor(rawCash);
    const rounded = remainder >= bid.rounding ? Math.ceil(rawCash) : Math.floor(rawCash);
    return parseFloat((rounded / 100).toFixed(4));
  }
  return parseFloat((rawCash / 100).toFixed(4));
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const locations = {};
  let lastError = null;
  const page = await browser.newPage();

  // mnvalleygrain.com returns 403 to headless Chrome default UA
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  try {
    // Load all-locations page (single request)
    console.log(`[${id}] navigating to ${config.url}`);
    await page.goto(config.url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    // ── Strategy 1: rendered DOM ──────────────────────────────────────────
    const domBids = await page.evaluate(() => {
      const results = [];
      for (const row of document.querySelectorAll('tr')) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 8) continue;
        const name = (cells[0]?.textContent || '').trim().toUpperCase();
        if (name !== 'CORN' && name !== 'SOYBEANS') continue;
        results.push({
          commodity:    name === 'SOYBEANS' ? 'beans' : 'corn',
          deliveryStart: (cells[1]?.textContent || '').trim(),
          futuresMonth: (cells[3]?.textContent || '').trim(),
          futuresPrice: (cells[4]?.textContent || '').trim(),
          change:       (cells[5]?.textContent || '').trim(),
          basis:        (cells[6]?.textContent || '').trim(),
          cash:         (cells[7]?.textContent || '').trim(),
        });
      }
      return results;
    });

    if (domBids.length > 0) {
      console.log(`[${id}] DOM strategy: found ${domBids.length} bid rows — quotes loaded OK`);
      // DOM has rendered data — group by table/location
      // Since all-locations page shows all 3, we group every N bids per location
      const bidsPerLoc = Math.floor(domBids.length / config.locations.length);
      for (let i = 0; i < config.locations.length; i++) {
        const loc = config.locations[i];
        const slug = slugify(loc.name);
        locations[slug] = { name: loc.name, corn: [], beans: [] };
        const start = i * bidsPerLoc;
        const end = i === config.locations.length - 1 ? domBids.length : start + bidsPerLoc;
        for (let j = start; j < end; j++) {
          const bid = domBids[j];
          const cash = parseFloat((bid.cash || '').replace(/[^0-9.\-]/g, ''));
          const basis = parseFloat((bid.basis || '').replace(/[^0-9.\-]/g, ''));
          if (!isNaN(cash) && cash > 0) {
            locations[slug][bid.commodity].push({
              delivery:     deliveryLabel(bid.deliveryStart),
              cash,
              futuresMonth: bid.futuresMonth || null,
              basis:        isNaN(basis) ? null : basis / 100,
              change:       bid.change || null,
              cbot:         bid.futuresPrice || null,
            });
          }
        }
      }
    } else {
      // ── Strategy 2: parse source HTML ─────────────────────────────────
      console.log(`[${id}] DOM has no bid rows — falling back to source parsing`);

      const html = await page.content();

      // Extract writeBidRow() calls
      const bidCalls = extractBidCalls(html);
      console.log(`[${id}] extracted ${bidCalls.length} writeBidRow() calls from source`);

      if (bidCalls.length === 0) {
        // Log page info for debugging
        const info = await page.evaluate(() => ({
          title: document.title,
          bodyLen: document.body?.innerHTML?.length || 0,
          scriptCount: document.querySelectorAll('script').length,
        }));
        console.warn(`[${id}] no writeBidRow calls found — page info: ${JSON.stringify(info)}`);
        lastError = 'no writeBidRow calls found in page source';
      } else {
        // Try to read the quotes object from the page
        const quotes = await page.evaluate(() => {
          if (typeof window.quotes === 'undefined' || !window.quotes) return null;
          const r = {};
          for (const [k, v] of Object.entries(window.quotes)) {
            r[k] = { rawLast: v.rawLast, unitcode: v.unitcode, symbol: v.symbol };
          }
          return r;
        });

        const quoteCount = quotes ? Object.keys(quotes).length : 0;
        console.log(`[${id}] quotes from page: ${quoteCount} symbols`);

        if (quoteCount === 0) {
          // Last resort: try fetching quotes via Barchart's getQuote endpoint
          // embedded in the page source
          const fetchedQuotes = await tryFetchQuotes(page, html, bidCalls);
          if (fetchedQuotes) {
            console.log(`[${id}] fetched ${Object.keys(fetchedQuotes).length} quotes via API`);
            Object.assign(quotes || {}, fetchedQuotes);
          }
        }

        // Group bids by location
        const groups = groupByLocation(bidCalls, config);

        for (const [slug, group] of Object.entries(groups)) {
          locations[slug] = { name: group.name, corn: [], beans: [] };

          for (const bid of group.bids) {
            const quote = quotes?.[bid.quoteKey];
            const cash = computeCash(bid, quote);

            if (cash !== null && cash > 0) {
              const commodity = bid.commodity === 'SOYBEANS' ? 'beans' : 'corn';
              locations[slug][commodity].push({
                delivery:     deliveryLabel(bid.delStart),
                cash,
                futuresMonth: quote?.symbol || bid.quoteKey,
                basis:        bid.basis / 100,
                change:       null,
                cbot:         null,
              });
            }
          }

          const cc = locations[slug].corn.length;
          const bc = locations[slug].beans.length;
          console.log(`[${id}:${slug}] corn: ${cc} bids, beans: ${bc} bids`);
          if (cc > 0) console.log(`[${id}:${slug}]   corn nearby: $${locations[slug].corn[0].cash} basis ${locations[slug].corn[0].basis} (${locations[slug].corn[0].delivery})`);
          if (bc > 0) console.log(`[${id}:${slug}]   beans nearby: $${locations[slug].beans[0].cash} basis ${locations[slug].beans[0].basis} (${locations[slug].beans[0].delivery})`);
        }
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

// ── Try to fetch quotes directly via Barchart API ────────────────────────────
// Looks for the Barchart quote script URL in the page source and fetches quotes.

async function tryFetchQuotes(page, html, bidCalls) {
  // Collect unique quote symbols needed
  const symbols = [...new Set(bidCalls.map(b => b.quoteKey))];
  if (symbols.length === 0) return null;

  console.log(`[mvg] need quotes for: ${symbols.join(', ')}`);

  // Look for Barchart quote script URL in page source
  // Common patterns: /getQuote.json, /quotes/get, etc.
  const apiMatch = html.match(/https?:\/\/[^"'\s]+getQuote[^"'\s]*/i)
    || html.match(/https?:\/\/ondemand\.websol\.barchart\.com[^"'\s]*/i);

  if (apiMatch) {
    console.log(`[mvg] found Barchart API URL: ${apiMatch[0]}`);
    // Could try to call it — but likely needs API key / auth
  }

  // Try to evaluate quotes after a longer wait (maybe they loaded late)
  await new Promise(r => setTimeout(r, 5000));
  const lateQuotes = await page.evaluate(() => {
    if (typeof window.quotes === 'undefined' || !window.quotes) return null;
    const r = {};
    for (const [k, v] of Object.entries(window.quotes)) {
      r[k] = { rawLast: v.rawLast, unitcode: v.unitcode, symbol: v.symbol };
    }
    return r;
  });

  if (lateQuotes && Object.keys(lateQuotes).length > 0) {
    return lateQuotes;
  }

  console.warn(`[mvg] could not obtain Barchart quotes — cash prices unavailable`);
  return null;
}

module.exports = { parse };
