// scripts/grain/crystalvalley.js
// Crystal Valley Cooperative — grain cash bid scraper
// Source: crystalvalley.coop/grain/
// API: WordPress REST endpoint /wp-json/cv/v1/bids?location={slug}
// Returns JSON array of bid objects per location — no Puppeteer needed.
// 7 elevator locations in south-central MN (corn + soybeans).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const https = require('https');

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name) {
  return name.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function parseCash(val) {
  if (val == null) return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(num) ? null : num;
}

function parseBasis(val) {
  if (val == null) return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(num) ? null : num;
}

// Convert "March 2026" or "May 2026" → "Mar26" / "May26"
function deliveryLabel(str) {
  if (!str) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const trimmed = str.trim();

  // "March 2026" or "Mar 2026"
  const long = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (long) {
    const mon = months.find(m => long[1].toLowerCase().startsWith(m.toLowerCase()));
    if (mon) return mon + long[2].slice(2);
  }

  // "Mar26" or "Mar 26"
  const short = trimmed.match(/^([A-Za-z]{3})\s*(\d{2})$/);
  if (short) {
    const mon = months.find(m => m.toLowerCase() === short[1].toLowerCase());
    if (mon) return mon + short[2];
  }

  return trimmed;
}

// HTTPS GET returning parsed JSON
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (grow27 grain scraper)' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse failed: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// ── Main Parse Function ─────────────────────────────────────────────────────
// Receives: { id, config, browser }
// Returns:  { locations: { [slug]: { name, corn, beans } }, source, error }

async function parse({ id, config }) {
  const baseUrl = 'https://crystalvalley.coop/wp-json/cv/v1/bids';
  const configLocations = config.locations || [];
  const locations = {};
  let lastError = null;

  console.log(`[${id}] fetching bids from REST API: ${baseUrl}`);

  for (const loc of configLocations) {
    const slug = loc.slug || slugify(loc.name);
    // API expects location name with spaces (e.g. "la salle", "lake crystal")
    const apiSlug = loc.apiSlug || loc.name.toLowerCase();
    const url = `${baseUrl}?location=${encodeURIComponent(apiSlug)}`;

    console.log(`[${id}:${slug}] fetching ${url}`);

    try {
      const bids = await fetchJson(url);

      if (!Array.isArray(bids) || bids.length === 0) {
        console.warn(`[${id}:${slug}] no bids returned`);
        locations[slug] = { name: loc.name, corn: [], beans: [] };
        continue;
      }

      const corn = [];
      const beans = [];

      for (const bid of bids) {
        const crop = (bid.crop || '').trim().toLowerCase();
        const delivery = deliveryLabel(bid.deliveryDate || bid.monthAsString);
        if (!delivery) continue;

        const cash = parseCash(bid.cashBid);
        if (cash === null) continue;

        const entry = {
          delivery,
          cash,
          futuresMonth: bid.symbol || null,
          basis:        parseBasis(bid.basis),
          change:       bid.changeAsString || null,
          cbot:         bid.futuresAsString || null,
        };

        if (crop === 'corn') {
          corn.push(entry);
        } else if (crop === 'soybeans' || crop === 'beans') {
          beans.push(entry);
        }
      }

      locations[slug] = { name: loc.name, corn, beans };

      const cc = corn.length;
      const bc = beans.length;
      console.log(`[${id}:${slug}] corn: ${cc} bids, beans: ${bc} bids`);
      if (cc > 0) console.log(`[${id}:${slug}]   corn nearby: $${corn[0].cash} basis ${corn[0].basis} (${corn[0].delivery})`);
      if (bc > 0) console.log(`[${id}:${slug}]   beans nearby: $${beans[0].cash} basis ${beans[0].basis} (${beans[0].delivery})`);

    } catch (err) {
      console.error(`[${id}:${slug}] FAILED: ${err.message}`);
      lastError = err.message;
      locations[slug] = { name: loc.name, corn: [], beans: [] };
    }
  }

  const locCount = Object.keys(locations).length;
  const withData = Object.values(locations).filter(l => l.corn.length > 0 || l.beans.length > 0).length;
  console.log(`\n[${id}] scrape complete — ${locCount} locations (${withData} with data)`);

  if (withData === 0) {
    return { locations, source: 'fetch_failed', error: lastError || 'no locations with bid data' };
  }

  return { locations, source: 'scraped', error: lastError };
}

module.exports = { parse };
