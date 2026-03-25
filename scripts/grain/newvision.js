// scripts/grain/newvision.js
// New Vision Cooperative — grain cash bid scraper
// Source: newvision.coop/current-grain-prices/
// Widget: AgriCharts/Barchart cashbids.php — injects tables via document.write().
// Strategy: Navigate to the page and wait for the AgriCharts script to render
// tables. The script is a <script src="//newvision.agricharts.com/..."> that
// calls document.write() during page parse, generating per-location tables.
// Cash-only (no basis/futures). 22 locations across southern MN.
// robots.txt Crawl-delay: 10 — respected via 10s post-load wait.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const cheerio = require('cheerio');
const https   = require('https');
const http    = require('http');

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

// ── Fetch AgriCharts widget HTML directly ────────────────────────────────────
// The cashbids.php endpoint returns JavaScript containing document.write() calls.
// We fetch that JS, extract the HTML strings from the document.write() calls,
// and parse with cheerio. This avoids the document.write() timing issues in Puppeteer.

async function fetchWidgetHtml(page, id) {
  // First, navigate to the page to discover the agricharts script URL
  const scriptUrl = await page.evaluate(() => {
    const scripts = document.querySelectorAll('script[src*="agricharts"]');
    if (scripts.length > 0) return scripts[0].src;
    // Also check for inline script references
    const allScripts = document.querySelectorAll('script[src*="cashbids"]');
    if (allScripts.length > 0) return allScripts[0].src;
    return null;
  });

  if (!scriptUrl) {
    console.log(`[${id}] no agricharts script found on page, trying direct fetch approach`);
    return null;
  }

  console.log(`[${id}] found agricharts script: ${scriptUrl}`);

  // Respect crawl-delay before second request
  console.log(`[${id}] respecting crawl-delay — waiting 10s before fetching widget`);
  await new Promise(r => setTimeout(r, 10000));

  // Fetch the script content server-side (not in-browser — CORS blocks fetch())
  const jsContent = await new Promise((resolve, reject) => {
    const mod = scriptUrl.startsWith('https') ? https : http;
    mod.get(scriptUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching agricharts script`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  if (!jsContent) return null;

  console.log(`[${id}] fetched agricharts stage-1 JS — ${jsContent.length} chars`);

  // Stage 1 JS contains a widgetURL pointing to cashbids-js.php — the actual data endpoint.
  // Extract it: widgetURL = '//newvision.agricharts.com/inc/cashbids/cashbids-js.php?...'
  const widgetMatch = jsContent.match(/widgetURL\s*=\s*'([^']+)'/);
  if (!widgetMatch) {
    console.log(`[${id}] no widgetURL found in stage-1 JS`);
    console.log(`[${id}] JS snippet (first 2000):\n${jsContent.substring(0, 2000)}`);
    return null;
  }

  let widgetUrl = widgetMatch[1];
  // Ensure absolute URL
  if (widgetUrl.startsWith('//')) widgetUrl = 'https:' + widgetUrl;
  // Strip dynamic parts that require browser context (acCnt, document.location.search)
  widgetUrl = widgetUrl.replace(/&acCnt=.*$/, '');
  console.log(`[${id}] stage-2 widget URL: ${widgetUrl}`);

  // Respect crawl-delay before third request
  console.log(`[${id}] respecting crawl-delay — waiting 10s before fetching stage-2`);
  await new Promise(r => setTimeout(r, 10000));

  // Fetch stage-2 — this returns the actual HTML tables (or JS that writes them)
  const stage2Content = await new Promise((resolve, reject) => {
    const mod = widgetUrl.startsWith('https') ? https : http;
    mod.get(widgetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching stage-2 widget`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });

  console.log(`[${id}] fetched stage-2 — ${stage2Content.length} chars`);
  console.log(`[${id}] stage-2 snippet (first 3000):\n${stage2Content.substring(0, 3000)}`);

  // Stage 2 might be raw HTML or JS with document.write(). Try both.
  // If it starts with '<' it's likely HTML
  if (stage2Content.trim().startsWith('<')) {
    return stage2Content;
  }

  // Otherwise extract HTML from document.write() or innerHTML assignments
  const htmlParts = [];

  // Pattern 1: document.write("...HTML...")
  const writePattern = /document\.write\s*\(\s*["']([\s\S]*?)["']\s*\)/g;
  let match;
  while ((match = writePattern.exec(stage2Content)) !== null) {
    htmlParts.push(match[1].replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, '\n'));
  }

  // Pattern 2: innerHTML = "...HTML..." or .innerHTML += "...HTML..."
  const innerPattern = /\.innerHTML\s*[+]?=\s*["']([\s\S]*?)["']/g;
  while ((match = innerPattern.exec(stage2Content)) !== null) {
    htmlParts.push(match[1].replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, '\n'));
  }

  // Pattern 3: widgetCode[n] = "...HTML..."
  const codePattern = /widgetCode\[\d+\]\s*=\s*["']([\s\S]*?)["']/g;
  while ((match = codePattern.exec(stage2Content)) !== null) {
    htmlParts.push(match[1].replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, '\n'));
  }

  if (htmlParts.length === 0) {
    console.log(`[${id}] no HTML extraction patterns matched in stage-2`);
    return null;
  }

  const fullHtml = htmlParts.join('\n');
  console.log(`[${id}] extracted ${htmlParts.length} HTML blocks — ${fullHtml.length} chars`);
  return fullHtml;
}

// ── Parse the widget HTML with cheerio ───────────────────────────────────────

function parseWidgetHtml(html, id, config) {
  const $ = cheerio.load(html);
  const locations = {};

  // From the screenshot: each location block has a bold centered header
  // (like "BEAVER CREEK") and a table with "Commodity" column + month columns.
  // The AgriCharts widget typically renders this with <b> or <strong> location
  // headers and <table> elements.

  // Strategy: find all tables, look backward for the location name
  const tables = $('table');
  console.log(`[${id}] cheerio found ${tables.length} tables`);

  tables.each((ti, table) => {
    const $table = $(table);

    // Get header row to find delivery month columns
    const headerCells = $table.find('th, thead td').map((i, el) => $(el).text().trim()).get();
    const monthPattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{2}/i;
    const deliveryIndices = [];
    const deliveryLabels = [];
    for (let i = 0; i < headerCells.length; i++) {
      if (monthPattern.test(headerCells[i])) {
        deliveryIndices.push(i);
        deliveryLabels.push(headerCells[i]);
      }
    }

    if (deliveryIndices.length === 0) {
      console.log(`[${id}] table ${ti}: no delivery month headers found — headers: ${JSON.stringify(headerCells)}`);
      return; // skip this table
    }

    // Find the location name — look for text before this table
    // AgriCharts typically uses <b>, <strong>, or <caption> for location names
    let locationName = null;

    // Check <caption>
    const caption = $table.find('caption').text().trim();
    if (caption) locationName = caption;

    // Check preceding sibling elements
    if (!locationName) {
      const prev = $table.prev();
      if (prev.length) {
        const prevText = prev.text().trim();
        if (prevText && prevText.length < 80 && !/commodity/i.test(prevText)) {
          locationName = prevText;
        }
      }
    }

    // Check parent for bold text before table
    if (!locationName) {
      const parent = $table.parent();
      const boldBefore = parent.find('b, strong').filter((i, el) => {
        // Only consider bold text that comes before this table in the DOM
        const elHtml = $.html(el);
        const tableHtml = $.html(table);
        return $.html(parent).indexOf(elHtml) < $.html(parent).indexOf(tableHtml);
      });
      if (boldBefore.length) {
        const lastBold = boldBefore.last().text().trim();
        if (lastBold && lastBold.length < 80 && !/commodity/i.test(lastBold)) {
          locationName = lastBold;
        }
      }
    }

    if (!locationName) {
      console.log(`[${id}] table ${ti}: could not determine location name — skipping`);
      return;
    }

    console.log(`[${id}] table ${ti}: location="${locationName}" — ${deliveryLabels.length} delivery months`);

    // Parse commodity rows
    const commodities = { corn: [], beans: [] };
    $table.find('tr').each((ri, row) => {
      const cells = $(row).find('td');
      if (cells.length < 2) return;

      const commodity = $(cells[0]).text().trim();
      let key = null;
      if (/^corn$/i.test(commodity)) key = 'corn';
      else if (/^soybeans?$/i.test(commodity)) key = 'beans';
      if (!key) return;

      for (let j = 0; j < deliveryIndices.length; j++) {
        const idx = deliveryIndices[j];
        const priceText = $(cells[idx]).text().trim();
        if (priceText && priceText !== '-' && priceText !== '') {
          const cash = parseCash(priceText);
          if (cash !== null) {
            commodities[key].push({
              delivery:     deliveryLabel(deliveryLabels[j]),
              cash:         cash,
              futuresMonth: null,
              basis:        null,
              change:       null,
              cbot:         null,
            });
          }
        }
      }
    });

    // Match to configured location
    const matchedLoc = matchLocation(locationName, config);
    if (!matchedLoc) {
      console.log(`[${id}] unmatched location: "${locationName}" — storing with auto-slug`);
      const slug = slugify(locationName);
      locations[slug] = { name: locationName, ...commodities };
    } else {
      const slug = matchedLoc.slug || slugify(matchedLoc.name);
      locations[slug] = { name: matchedLoc.name, ...commodities };
    }
  });

  return locations;
}

// ── Main Parse Function ─────────────────────────────────────────────────────

async function parse({ id, config, browser }) {
  const locations = {};
  let lastError = null;
  const page = await browser.newPage();

  try {
    console.log(`[${id}] navigating to ${config.url}`);
    await page.goto(config.url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Respect robots.txt Crawl-delay: 10
    console.log(`[${id}] respecting crawl-delay — waiting 10s`);
    await new Promise(r => setTimeout(r, 10000));

    // Approach 1: try to fetch the AgriCharts widget HTML directly
    const widgetHtml = await fetchWidgetHtml(page, id);

    if (widgetHtml) {
      const parsed = parseWidgetHtml(widgetHtml, id, config);
      Object.assign(locations, parsed);
    }

    // Approach 2: if widget fetch failed, try DOM scraping (in case tables rendered)
    if (Object.keys(locations).length === 0 || !Object.values(locations).some(l => l.corn.length > 0 || l.beans.length > 0)) {
      console.log(`[${id}] widget fetch approach found no data — trying DOM scrape`);

      // Wait for tables that might have rendered
      await page.waitForSelector('table', { timeout: 10000 })
        .catch(() => console.warn(`[${id}] no tables in DOM either`));

      const domData = await page.evaluate(() => {
        const results = [];
        const tables = document.querySelectorAll('table');
        const monthPattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{2}/i;

        for (const table of tables) {
          const headerCells = Array.from(table.querySelectorAll('th, thead td'))
            .map(el => el.textContent.trim());
          const deliveryHeaders = headerCells.filter(h => monthPattern.test(h));
          if (deliveryHeaders.length === 0) continue;

          // Find location name from preceding element
          let locName = null;
          let el = table.previousElementSibling;
          let attempts = 0;
          while (el && attempts < 3) {
            const text = el.textContent.trim();
            if (text && text.length < 80 && !/commodity/i.test(text)) {
              locName = text;
              break;
            }
            el = el.previousElementSibling;
            attempts++;
          }
          if (!locName) continue;

          const rows = table.querySelectorAll('tr');
          for (const row of rows) {
            const cells = row.querySelectorAll('td');
            if (cells.length < 2) continue;
            const commodity = cells[0].textContent.trim();
            if (!/^(corn|soybeans?)$/i.test(commodity)) continue;

            const bids = [];
            const deliveryIndices = [];
            for (let i = 0; i < headerCells.length; i++) {
              if (monthPattern.test(headerCells[i])) deliveryIndices.push(i);
            }
            for (let j = 0; j < deliveryIndices.length; j++) {
              const price = cells[deliveryIndices[j]]?.textContent?.trim();
              if (price && price !== '-' && price !== '') {
                bids.push({ delivery: deliveryHeaders[j], cash: price });
              }
            }
            results.push({ location: locName, commodity, bids });
          }
        }
        return results;
      });

      if (domData.length > 0) {
        console.log(`[${id}] DOM scrape found ${domData.length} commodity rows`);
        for (const item of domData) {
          const matchedLoc = matchLocation(item.location, config);
          if (!matchedLoc) continue;
          const slug = matchedLoc.slug || slugify(matchedLoc.name);
          if (!locations[slug]) locations[slug] = { name: matchedLoc.name, corn: [], beans: [] };
          const key = /^corn$/i.test(item.commodity) ? 'corn' : 'beans';
          locations[slug][key] = item.bids.map(b => ({
            delivery: deliveryLabel(b.delivery), cash: parseCash(b.cash),
            futuresMonth: null, basis: null, change: null, cbot: null,
          })).filter(b => b.cash !== null && b.delivery);
        }
      }
    }

    // Ensure all configured locations exist (even if empty)
    for (const loc of (config.locations || [])) {
      const slug = loc.slug || slugify(loc.name);
      if (!locations[slug]) {
        locations[slug] = { name: loc.name, corn: [], beans: [] };
      }
    }

    // Log results
    for (const [slug, data] of Object.entries(locations)) {
      const cc = data.corn?.length || 0;
      const bc = data.beans?.length || 0;
      console.log(`[${id}:${slug}] corn: ${cc} bids, beans: ${bc} bids`);
      if (cc > 0) console.log(`[${id}:${slug}]   corn nearby: $${data.corn[0].cash} (${data.corn[0].delivery})`);
      if (bc > 0) console.log(`[${id}:${slug}]   beans nearby: $${data.beans[0].cash} (${data.beans[0].delivery})`);
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
    return { locations, source: 'fetch_failed', error: lastError || 'no locations with bid data' };
  }

  return { locations, source: 'scraped', error: lastError };
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
