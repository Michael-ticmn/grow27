// scripts/grain/chs.js
// CHS — cash bid scraper
// The cash bids page at chsag.com/grain/cash-bids/ renders a widget into
// div#cash-bids-root. All locations are stacked on the page — no dropdown
// interaction needed. Data is in divs (no <table> elements).
// Visible text per section: Location Name → Commodity → rows of
//   Delivery | Bid | Basis | Futures | Change | Futures Month
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
  const trimmed = str.trim().replace(/\s*SPOT ONLY/i, '');
  if (/spot/i.test(str)) return 'Spot';
  const m = trimmed.match(/^([A-Za-z]{3,})\s*(\d{4})/);
  if (m) {
    const mon = m[1].slice(0, 3);
    return mon.charAt(0).toUpperCase() + mon.slice(1).toLowerCase() + m[2].slice(2);
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

    // Wait for widget to render
    try {
      await page.waitForFunction(() => {
        const root = document.querySelector('#cash-bids-root, .cash-bids');
        return root && root.textContent.trim().length > 100;
      }, { timeout: 15000 });
    } catch (e) {
      console.warn(`[${id}] widget did not render within 15s`);
    }
    await new Promise(r => setTimeout(r, 2000));

    // Extract all bid data from the stacked page — all locations visible at once
    const allBids = await page.evaluate((configLocs) => {
      const root = document.querySelector('#cash-bids-root, .cash-bids, .block-cash-bids');
      if (!root) return { sections: [], debug: 'no root found' };

      const text = root.innerText;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      // All CHS locations — needed to detect section boundaries so bids
      // from unconfigured locations don't bleed into configured ones.
      const allLocations = [
        'Absolute Energy', 'Cahokia', 'Collins', 'Fairmont', 'Hallock',
        'Kasson', 'Mankato', 'Ostrander', 'Savage', 'Winona', 'Wykoff'
      ];
      const configNames = configLocs.map(l => l.name.toLowerCase());

      const sections = [];
      let currentLocation = null;
      let currentCommodity = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineLower = line.toLowerCase();

        // Detect ANY location header — reset context
        const isAnyLoc = allLocations.some(loc => lineLower.includes(loc.toLowerCase()));
        if (isAnyLoc && !/\d/.test(line)) {
          const matchedConfig = configLocs.find(l => lineLower.includes(l.name.toLowerCase()));
          currentLocation = matchedConfig ? matchedConfig.name : null;
          currentCommodity = null;
          continue;
        }

        // Detect commodity
        if (/yellow\s*corn/i.test(line) || line === 'Corn') {
          currentCommodity = 'corn';
          continue;
        }
        if (/soybean/i.test(line)) {
          currentCommodity = 'beans';
          continue;
        }

        // Skip header labels
        if (/^(location|commodity|cash bids|delivery|bid|basis|futures|change|futures month)$/i.test(line)) continue;

        // Skip if no location matched yet
        if (!currentLocation) continue;

        // Look for delivery period (month + year or SPOT)
        if ((/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(line) && /\d{4}/.test(line)) || /spot/i.test(line)) {
          const delivery = line;
          const bid = lines[i + 1] || null;
          const basis = lines[i + 2] || null;
          const futures = lines[i + 3] || null;
          const change = lines[i + 4] || null;
          const futMonth = lines[i + 5] || null;

          // Validate bid looks like a price
          if (bid && /^-?\d+\.\d+/.test(bid)) {
            sections.push({
              location: currentLocation,
              commodity: currentCommodity || 'corn',
              delivery,
              cash: bid,
              basis,
              futures,
              change,
              futuresMonth: futMonth,
            });
            i += 5;
          }
        }
      }

      return { sections, debug: `${lines.length} lines parsed` };
    }, config.locations);

    console.log(`[${id}] ${allBids.debug}, ${allBids.sections.length} total bids`);

    // Group into locations
    for (const bid of allBids.sections) {
      const slug = slugify(bid.location);
      if (!locations[slug]) {
        locations[slug] = { name: bid.location, corn: [], beans: [] };
      }

      const entry = {
        delivery:     deliveryLabel(bid.delivery),
        cash:         parseCash(bid.cash),
        futuresMonth: bid.futuresMonth || null,
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

    // Log results
    for (const [slug, data] of Object.entries(locations)) {
      const cc = data.corn?.length || 0;
      const bc = data.beans?.length || 0;
      console.log(`[${id}:${slug}] corn: ${cc} bids, beans: ${bc} bids`);
      if (cc > 0) console.log(`[${id}:${slug}]   corn nearby: $${data.corn[0].cash} basis ${data.corn[0].basis} (${data.corn[0].delivery})`);
      if (bc > 0) console.log(`[${id}:${slug}]   beans nearby: $${data.beans[0].cash} basis ${data.beans[0].basis} (${data.beans[0].delivery})`);
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
