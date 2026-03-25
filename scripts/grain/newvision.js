// scripts/grain/newvision.js
// New Vision Cooperative — grain cash bid scraper
// Source: newvision.coop/current-grain-prices/
// Widget: AgriCharts/Barchart — two-stage loader.
//   Stage 1 (cashbids.php): JS bootstrap that contains widgetURL pointing to stage 2.
//   Stage 2 (cashbids-js.php): JS containing `var bids = [...]` JSON with all bid data.
// Strategy: Navigate page → find agricharts script → fetch stage-1 → extract widgetURL →
//   fetch stage-2 → parse JSON bids array directly.
// 22 locations across southern MN. Cash prices with basis data.
// robots.txt Crawl-delay: 10 — respected between all requests.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const https = require('https');
const http  = require('http');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// Convert "Mar 26" or "March 2026" or "Mar26" → "Mar26"
function deliveryLabel(str) {
  if (!str) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const trimmed = str.trim();

  // "Mar 26" or "Mar26"
  const short = trimmed.match(/^([A-Za-z]{3})\s*(\d{2})$/);
  if (short) {
    const mon = months.find(m => m.toLowerCase() === short[1].toLowerCase());
    if (mon) return mon + short[2];
  }

  // "March 2026" or "Mar 2026"
  const long = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (long) {
    const mon = months.find(m => long[1].toLowerCase().startsWith(m.toLowerCase()));
    if (mon) return mon + long[2].slice(2);
  }

  return trimmed;
}

// Simple HTTPS/HTTP GET returning a string
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const locations = {};
  const page = await browser.newPage();

  try {
    // Step 1: Navigate to the page to find the agricharts script URL
    console.log(`[${id}] navigating to ${config.url}`);
    await page.goto(config.url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Respect robots.txt Crawl-delay: 10
    console.log(`[${id}] respecting crawl-delay — waiting 10s`);
    await new Promise(r => setTimeout(r, 10000));

    const scriptUrl = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[src*="agricharts"], script[src*="cashbids"]');
      return scripts.length > 0 ? scripts[0].src : null;
    });

    if (!scriptUrl) {
      console.error(`[${id}] no agricharts script found on page`);
      return { locations: {}, source: 'fetch_failed', error: 'no agricharts script found' };
    }
    console.log(`[${id}] found stage-1 script: ${scriptUrl}`);

    // Step 2: Fetch stage-1 JS to get the widgetURL
    console.log(`[${id}] respecting crawl-delay — waiting 10s`);
    await new Promise(r => setTimeout(r, 10000));

    const stage1 = await httpGet(scriptUrl);
    console.log(`[${id}] fetched stage-1 — ${stage1.length} chars`);

    const widgetMatch = stage1.match(/widgetURL\s*=\s*'([^']+)'/);
    if (!widgetMatch) {
      console.error(`[${id}] no widgetURL in stage-1 JS`);
      return { locations: {}, source: 'fetch_failed', error: 'no widgetURL found' };
    }

    let widgetUrl = widgetMatch[1];
    if (widgetUrl.startsWith('//')) widgetUrl = 'https:' + widgetUrl;
    widgetUrl = widgetUrl.replace(/&acCnt=.*$/, '');
    // Remove location filter to get ALL locations instead of just one
    widgetUrl = widgetUrl.replace(/[&?]location=\d+/, '');
    widgetUrl = widgetUrl.replace(/[&?]locations=\d+/, '');
    // Remove commodity filter to get ALL commodities (corn + soybeans)
    widgetUrl = widgetUrl.replace(/[&?]commodity=\d+/, '');
    widgetUrl = widgetUrl.replace(/[&?]commodities=\d*/, '');
    console.log(`[${id}] stage-2 URL (all locations): ${widgetUrl}`);

    // Step 3: Fetch stage-2 JS containing the JSON bids data
    console.log(`[${id}] respecting crawl-delay — waiting 10s`);
    await new Promise(r => setTimeout(r, 10000));

    const stage2 = await httpGet(widgetUrl);
    console.log(`[${id}] fetched stage-2 — ${stage2.length} chars`);

    // Step 4: Extract the bids JSON from `var bids = [...]`
    const bidsMatch = stage2.match(/var\s+bids\s*=\s*(\[[\s\S]*?\]);/);
    if (!bidsMatch) {
      console.error(`[${id}] no "var bids = [...]" found in stage-2`);
      console.log(`[${id}] stage-2 first 1000 chars:\n${stage2.substring(0, 1000)}`);
      return { locations: {}, source: 'fetch_failed', error: 'no bids JSON found' };
    }

    let bids;
    try {
      bids = JSON.parse(bidsMatch[1]);
    } catch (e) {
      console.error(`[${id}] JSON parse failed: ${e.message}`);
      return { locations: {}, source: 'fetch_failed', error: 'bids JSON parse failed' };
    }

    console.log(`[${id}] parsed ${bids.length} location entries from JSON`);

    // Step 5: Process each location's cashbids
    for (const loc of bids) {
      const locName = (loc.name || loc.display_name || '').trim();
      if (!locName) continue;

      const matchedLoc = matchLocation(locName, config);
      const slug = matchedLoc
        ? (matchedLoc.slug || slugify(matchedLoc.name))
        : slugify(locName);
      const displayName = matchedLoc ? matchedLoc.name : locName;

      const corn = [];
      const beans = [];

      for (const bid of (loc.cashbids || [])) {
        const commodity = (bid.name || '').trim();
        const cash = parseCash(bid.price || bid.cashprice);
        const delivery = deliveryLabel(bid.delivery_start);

        if (cash === null || !delivery) continue;

        const entry = {
          delivery,
          cash,
          futuresMonth: null,
          basis:        bid.basis != null ? Number(bid.basis) / 100 : null,  // basis is in cents
          change:       null,
          cbot:         null,
        };

        if (/corn/i.test(commodity)) {
          corn.push(entry);
        } else if (/soybean|bean/i.test(commodity)) {
          beans.push(entry);
        }
      }

      locations[slug] = { name: displayName, corn, beans };

      const cc = corn.length;
      const bc = beans.length;
      if (cc > 0 || bc > 0) {
        console.log(`[${id}:${slug}] corn: ${cc} bids, beans: ${bc} bids`);
        if (cc > 0) console.log(`[${id}:${slug}]   corn nearby: $${corn[0].cash} (${corn[0].delivery})`);
        if (bc > 0) console.log(`[${id}:${slug}]   beans nearby: $${beans[0].cash} (${beans[0].delivery})`);
      }
    }

    // Ensure all configured locations exist (even if empty)
    for (const loc of (config.locations || [])) {
      const slug = loc.slug || slugify(loc.name);
      if (!locations[slug]) {
        locations[slug] = { name: loc.name, corn: [], beans: [] };
      }
    }

  } catch (err) {
    console.error(`[${id}] SCRAPE FAILED: ${err.message}`);
    return { locations: {}, source: 'fetch_failed', error: err.message };
  } finally {
    await page.close();
  }

  const locCount = Object.keys(locations).length;
  const withData = Object.values(locations).filter(l => l.corn.length > 0 || l.beans.length > 0).length;
  console.log(`\n[${id}] scrape complete — ${locCount} locations (${withData} with data)`);

  if (withData === 0) {
    return { locations, source: 'fetch_failed', error: 'no locations with bid data' };
  }

  return { locations, source: 'scraped' };
}

// ── Location matching ────────────────────────────────────────────────────────

function matchLocation(scrapedName, config) {
  if (!scrapedName) return null;
  const lower = scrapedName.trim().toLowerCase();
  const configLocations = config.locations || [];

  // Exact match
  for (const loc of configLocations) {
    if (loc.name.toLowerCase() === lower) return loc;
  }

  // Partial match
  for (const loc of configLocations) {
    const confLower = loc.name.toLowerCase();
    if (lower.includes(confLower) || confLower.includes(lower)) return loc;
  }

  return null;
}

module.exports = { parse };
