// scripts/scrape-barns.js
// grow27 — auction barn price scraper
// Runs via GitHub Actions daily at 7am CT.
// Reads data/barns-config.json, writes data/prices/<id>.json + data/prices/index.json.
// Deps: cheerio (HTML parsing), puppeteer (JS-rendered pages), @anthropic-ai/sdk (vision).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs        = require('fs');
const path      = require('path');
const cheerio   = require('cheerio');
const puppeteer = require('puppeteer');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT         = path.join(__dirname, '..');
const CONFIG_PATH  = path.join(ROOT, 'data', 'barns-config.json');
const PRICES_DIR   = path.join(ROOT, 'data', 'prices');
const INDEX_PATH   = path.join(PRICES_DIR, 'index.json');

const MAX_HISTORY  = 14;
const MAX_AGE_DAYS = 14;

const SLAUGHTER_DISC = { beef: 0, crossbred: 9.50, holstein: 30.00 };
const FEEDER_FACTOR  = 0.40;

const anthropic = new Anthropic();   // reads ANTHROPIC_API_KEY from env

// ── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function trimHistory(history) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  const cutStr = cutoff.toISOString().slice(0, 10);
  return history.filter(e => e.date >= cutStr).slice(-MAX_HISTORY);
}

// ── Puppeteer fetch (handles JS-rendered pages) ─────────────────────────────

async function fetchRenderedHtml(url) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  const html = await page.content();
  await browser.close();
  return html;
}

// ── Vision-based scraper (for barns that publish report as PNG image) ────────

const VISION_PROMPT = `Extract cattle price data from this market report image. Return JSON only, no other text:
{
  "slaughter": {
    "beef": <midpoint of Finished Beef Steers range as number, or null>,
    "crossbred": <midpoint of Finished Dairy-X Steers & Heifers range as number, or null>,
    "holstein": <midpoint of Finished Dairy Steers range as number, or null>
  },
  "feeder": {
    "beef": <midpoint of Feeder Cattle (any variant of this header) range as number, or null>,
    "holstein": <midpoint of Dairy Steers (any variant) range as number, or null>,
    "liteTest": <true if "lite test" appears anywhere near feeder headers, false otherwise>
  }
}
Return null for any value not found in the image. Numbers should be in cents per cwt (e.g. 231.50).`;

async function scrapeBarns(config) {
  const { id, reportUrl } = config;

  // ── 1. Fetch rendered HTML via Puppeteer ────────────────────────────────
  let html;
  try {
    console.log(`[${id}] launching Puppeteer for: ${reportUrl}`);
    html = await fetchRenderedHtml(reportUrl);
    console.log(`[${id}] fetch OK · ${html.length} bytes`);
    if (html.length < 500) throw new Error('response too short — likely blocked or empty');
  } catch (fetchErr) {
    console.error(`[${id}] FETCH FAILED: ${fetchErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: fetchErr.message };
  }

  // ── 2. Extract og:image URL containing the market report PNG ──────────
  let imageUrl;
  try {
    const $ = cheerio.load(html);
    const ogImages = [];
    $('meta[property="og:image"]').each((_, el) => {
      const url = $(el).attr('content');
      if (url) ogImages.push(url);
    });
    console.log(`[${id}] og:image URLs found: ${ogImages.length}`);
    ogImages.forEach((u, i) => console.log(`[${id}]   [${i}] ${u}`));

    // Prefer URL containing "screenshot" or typical report-image patterns
    imageUrl = ogImages.find(u => /screenshot/i.test(u))
            || ogImages.find(u => /report|market|cattle|price/i.test(u))
            || ogImages[0];

    if (!imageUrl) throw new Error('no og:image meta tag found');
    console.log(`[${id}] selected image URL: ${imageUrl}`);
  } catch (imgErr) {
    console.error(`[${id}] IMAGE EXTRACT FAILED: ${imgErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: imgErr.message };
  }

  // ── 3. Download PNG as base64 ─────────────────────────────────────────
  let imageBase64;
  let mediaType = 'image/png';
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`);
    const contentType = imgRes.headers.get('content-type') || 'image/png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) mediaType = 'image/jpeg';
    else if (contentType.includes('webp')) mediaType = 'image/webp';
    else if (contentType.includes('gif')) mediaType = 'image/gif';
    const buf = Buffer.from(await imgRes.arrayBuffer());
    imageBase64 = buf.toString('base64');
    console.log(`[${id}] image downloaded · ${buf.length} bytes · ${mediaType}`);
  } catch (dlErr) {
    console.error(`[${id}] IMAGE DOWNLOAD FAILED: ${dlErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: dlErr.message };
  }

  // ── 4. Send to Claude vision API for price extraction ─────────────────
  try {
    console.log(`[${id}] sending image to Claude API (claude-sonnet-4-20250514)...`);
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: VISION_PROMPT,
          },
        ],
      }],
    });

    const rawText = response.content[0].text.trim();
    console.log(`[${id}] Claude response:\n${rawText}`);

    // Strip markdown fences if present
    const jsonStr = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr);

    const slaughter = {
      beef:      typeof parsed.slaughter?.beef      === 'number' ? parsed.slaughter.beef      : null,
      crossbred: typeof parsed.slaughter?.crossbred === 'number' ? parsed.slaughter.crossbred : null,
      holstein:  typeof parsed.slaughter?.holstein  === 'number' ? parsed.slaughter.holstein  : null,
    };
    const feeder = {
      beef:      typeof parsed.feeder?.beef      === 'number' ? parsed.feeder.beef      : null,
      crossbred: null,
      holstein:  typeof parsed.feeder?.holstein  === 'number' ? parsed.feeder.holstein  : null,
      liteTest:  !!parsed.feeder?.liteTest,
    };

    // Derive crossbred feeder from beef feeder
    if (feeder.beef !== null) {
      feeder.crossbred = parseFloat(
        (feeder.beef - SLAUGHTER_DISC.crossbred * FEEDER_FACTOR).toFixed(2)
      );
      console.log(`[${id}] feeder.crossbred = ${feeder.crossbred} (derived from beef)`);
    }

    const hasSlaughter = Object.values(slaughter).some(v => v !== null);
    const hasFeeder    = feeder.beef !== null || feeder.holstein !== null;
    console.log(`[${id}] parse result — hasSlaughter=${hasSlaughter} hasFeeder=${hasFeeder}`);

    if (!hasSlaughter && !hasFeeder) {
      throw new Error('Claude returned no usable prices');
    }

    return { slaughter, feeder, source: 'scraped', error: null };

  } catch (apiErr) {
    console.error(`[${id}] CLAUDE API ERROR: ${apiErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: apiErr.message };
  }
}

// ── Null entry builder ────────────────────────────────────────────────────────

function nullEntry(dateStr, source = 'pending') {
  return {
    date: dateStr,
    slaughter: { beef: null, crossbred: null, holstein: null },
    feeder:    { beef: null, crossbred: null, holstein: null, liteTest: false },
    source,
  };
}

// ── Load / save helpers ───────────────────────────────────────────────────────

function loadBarnFile(id, name, location) {
  const p = path.join(PRICES_DIR, `${id}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    console.log(`[${id}] loaded ${p} · history length: ${data.history.length}`);
    return data;
  } catch (e) {
    console.warn(`[${id}] could not load ${p} (${e.message}) — starting fresh`);
    return { id, name, location, lastUpdated: today(), lastSuccess: null, history: [] };
  }
}

function saveBarnFile(data) {
  const p = path.join(PRICES_DIR, `${data.id}.json`);
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
    // ── 5. Confirm write ──────────────────────────────────────────────────
    console.log(`[${data.id}] wrote ${p} · history length: ${data.history.length}`);
  } catch (e) {
    console.error(`[${data.id}] WRITE FAILED: ${p} — ${e.message}`);
    throw e;
  }
}

// ── Trend helper ──────────────────────────────────────────────────────────────

function calcTrend(history) {
  const good = [...history]
    .reverse()
    .filter(e => (e.source === 'scraped' || e.source === 'calculated') && e.slaughter?.beef != null);
  if (good.length < 2) return null;
  const diff = good[0].slaughter.beef - good[1].slaughter.beef;
  if (diff >  0.5) return 'up';
  if (diff < -0.5) return 'down';
  return 'flat';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const todayStr = today();
  console.log(`\n=== grow27 barn scraper · ${todayStr} ===`);
  console.log(`ROOT: ${ROOT}`);
  console.log(`CONFIG: ${CONFIG_PATH}`);
  console.log(`PRICES_DIR: ${PRICES_DIR}\n`);

  const barnsConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  console.log(`Loaded config · ${barnsConfig.length} barns\n`);

  const indexOut = [];

  for (const config of barnsConfig) {
    const { id, name, location } = config;
    console.log(`\n════ ${id} (${name}) ════`);

    // ── 1. Load existing file ─────────────────────────────────────────────
    const barnData = loadBarnFile(id, name, location);

    let entry;
    if (config.hasTypeBreakdown && config.reportUrl) {
      // ── 2. Attempt live scrape ──────────────────────────────────────────
      const result = await scrapeBarns(config);
      entry = {
        date:      todayStr,
        slaughter: result.slaughter ?? { beef: null, crossbred: null, holstein: null },
        feeder:    result.feeder    ?? { beef: null, crossbred: null, holstein: null, liteTest: false },
        source:    result.source,
      };
      if (result.error) entry.error = result.error;
      if (result.source === 'scraped') barnData.lastSuccess = todayStr;
    } else {
      // No type breakdown / no report URL — write pending entry
      entry = nullEntry(todayStr, 'pending');
      console.log(`[${id}] no reportUrl or no type breakdown — writing pending entry`);
    }

    console.log(`[${id}] entry to append: ${JSON.stringify(entry)}`);

    // Trim then append — never duplicate same-date entries
    barnData.history = trimHistory(barnData.history).filter(e => e.date !== todayStr);
    barnData.history.push(entry);
    barnData.lastUpdated = todayStr;

    // ── 5. Save ───────────────────────────────────────────────────────────
    saveBarnFile(barnData);

    // Build index row from most-recent successful entry
    const recent = [...barnData.history]
      .reverse()
      .find(e => e.source === 'scraped' || e.source === 'calculated');

    indexOut.push({
      id,
      name,
      location,
      lastSuccess: barnData.lastSuccess,
      slaughter:  recent?.slaughter ?? { beef: null, crossbred: null, holstein: null },
      feeder:     recent?.feeder    ?? { beef: null, crossbred: null, holstein: null, liteTest: false },
      trend:      calcTrend(barnData.history),
      source:     recent?.source ?? 'pending',
    });
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexOut, null, 2) + '\n');
  console.log('\n=== index.json updated ===');
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
