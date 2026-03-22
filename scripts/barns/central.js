// scripts/barns/central.js
// Central Livestock Association — Zumbrota MN
// Parses OCR text from report screenshots (main image + rep sales images).
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Lazy-require heavy deps (installed in GitHub Actions, not locally)
let sharp, Tesseract;
function ensureDeps() {
  if (!sharp)     sharp     = require('sharp');
  if (!Tesseract) Tesseract = require('tesseract.js');
}

// Import shared helpers from the orchestrator
const {
  normalizePrice, extractLinePrice, RANGE_RE, SPACE_RANGE_RE, SINGLE_RE
} = require('../scrape-barns');

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractPriceSkipWeights(line) {
  const cleaned = line
    .replace(/\d{2,4}\s*[-–]\s*\d{2,4}\s*[%#]/g, '')
    .replace(/under\s+\d+[#%]/gi, '')
    .replace(/upto\s*[-–]\s*/gi, '');
  return extractLinePrice(cleaned);
}

function extractUptoPrice(line) {
  const m = line.match(/upto\s*[-–]?\s*(\d{3,5}(?:\.\d{2})?)/i);
  if (m) {
    const v = normalizePrice(m[1]);
    if (v !== null) return parseFloat(v.toFixed(2));
  }
  return null;
}

// Normalize OCR text: force ASCII English characters
function normalizeOcr(text) {
  return text
    .replace(/\u00d1/g, 'X')
    .replace(/\u00f1/g, 'x')
    .replace(/[^\x20-\x7E\n\r\t]/g, '');
}

// Strip right-table bleed-through noise after the Price column
function cleanRepLines(text) {
  return text.split('\n').map(line =>
    line.replace(/(\d{3,6}(?:\.\d{2})?)\s+[A-Za-z].*$/, '$1')
  ).join('\n');
}

// ── Constants ────────────────────────────────────────────────────────────────

const SLAUGHTER_DISC = { beef: 0, crossbred: 9.50, holstein: 30.00 };
const FEEDER_FACTOR  = 0.40;

// ── Main Parse Function ─────────────────────────────────────────────────────
// Receives: { id, browser, html, $ (cheerio) }
// Returns:  standard barn result object

async function parse({ id, browser, html, $ }) {
  ensureDeps();

  // ── 1. Extract og:image URLs ────────────────────────────────────────────
  let imageUrl;
  let repImageUrls = [];
  try {
    const ogImages = [];
    $('meta[property="og:image"]').each((_, el) => {
      const url = $(el).attr('content');
      if (url) ogImages.push(url);
    });
    console.log(`[${id}] og:image URLs found: ${ogImages.length}`);
    ogImages.forEach((u, i) => console.log(`[${id}]   [${i}] ${u}`));

    imageUrl = ogImages.find(u => /screenshot/i.test(u))
            || ogImages.find(u => /report|market|cattle|price/i.test(u))
            || ogImages[0];

    if (!imageUrl) throw new Error('no og:image meta tag found');
    console.log(`[${id}] selected image URL: ${imageUrl}`);

    repImageUrls = ogImages.filter(u => u !== imageUrl);
    console.log(`[${id}] additional images for rep sales: ${repImageUrls.length}`);
  } catch (imgErr) {
    console.error(`[${id}] IMAGE EXTRACT FAILED: ${imgErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: imgErr.message };
  }

  // ── 2. Download main PNG via Puppeteer ──────────────────────────────────
  let imgBuffer;
  try {
    const page = await browser.newPage();
    const imgResponse = await page.goto(imageUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    if (!imgResponse.ok()) throw new Error(`HTTP ${imgResponse.status()}`);
    imgBuffer = await imgResponse.buffer();
    console.log(`[${id}] image downloaded via Puppeteer · ${imgBuffer.length} bytes`);
  } catch (dlErr) {
    console.error(`[${id}] IMAGE DOWNLOAD FAILED: ${dlErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: dlErr.message };
  }

  // ── 3. Run Tesseract OCR on main image ──────────────────────────────────
  let ocrText;
  try {
    console.log(`[${id}] running Tesseract OCR on main image...`);
    const { data } = await Tesseract.recognize(imgBuffer, 'eng');
    ocrText = normalizeOcr(data.text);
    console.log(`[${id}] OCR complete · ${ocrText.length} chars`);
    console.log(`[${id}] OCR text preview:\n${ocrText.slice(0, 1000)}\n`);
  } catch (ocrErr) {
    console.error(`[${id}] OCR FAILED: ${ocrErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: ocrErr.message };
  }

  // ── 4. Download and OCR rep sales images (side-by-side tables) ──────────
  const repOcrTexts = [];
  for (const repUrl of repImageUrls) {
    try {
      console.log(`[${id}] downloading rep sales image: ${repUrl}`);
      const page = await browser.newPage();
      const resp = await page.goto(repUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      if (!resp.ok()) { console.warn(`[${id}] rep image HTTP ${resp.status()}`); continue; }
      const buf = await resp.buffer();
      console.log(`[${id}] rep image downloaded · ${buf.length} bytes`);

      const meta = await sharp(buf).metadata();
      const w = meta.width;
      const h = meta.height;
      console.log(`[${id}] rep image size: ${w}x${h}`);

      // Adaptive crop: scan header strip to find left/right table boundaries
      const headerH = Math.min(100, Math.floor(h * 0.2));
      let splitL = Math.floor(w * 0.6);

      for (let pct = 45; pct <= 70; pct += 5) {
        const testW = Math.floor(w * pct / 100);
        const testBuf = await sharp(buf)
          .extract({ left: 0, top: 0, width: testW, height: headerH })
          .png().toBuffer();
        const { data: testData } = await Tesseract.recognize(testBuf, 'eng');
        const testText = (testData.text || '').toLowerCase();
        if (/price/.test(testText)) {
          splitL = Math.min(Math.floor(w * 0.75), testW + Math.floor(w * 0.08));
          console.log(`[${id}] left table "Price" found at ${pct}% — crop with padding: ${splitL}px`);
          break;
        }
      }

      let splitR = Math.max(0, splitL - Math.floor(w * 0.15));
      for (let pct = 55; pct >= 30; pct -= 5) {
        const startX = Math.floor(w * pct / 100);
        const testBuf = await sharp(buf)
          .extract({ left: startX, top: 0, width: w - startX, height: headerH })
          .png().toBuffer();
        const { data: testData } = await Tesseract.recognize(testBuf, 'eng');
        const testText = (testData.text || '').toLowerCase();
        if (/location/.test(testText) && /price/.test(testText)) {
          splitR = Math.max(0, startX - Math.floor(w * 0.05));
          console.log(`[${id}] right table "Location" found at ${pct}% — crop with padding from ${splitR}px`);
          break;
        }
      }

      console.log(`[${id}] adaptive crop — left: 0-${splitL}px, right: ${splitR}-${w}px`);

      // Crop each half, upscale 2x for better OCR
      const leftBuf = await sharp(buf)
        .extract({ left: 0, top: 0, width: splitL, height: h })
        .resize({ width: splitL * 2, height: h * 2, kernel: 'lanczos3' })
        .sharpen()
        .png().toBuffer();
      const rightBuf = await sharp(buf)
        .extract({ left: splitR, top: 0, width: w - splitR, height: h })
        .resize({ width: (w - splitR) * 2, height: h * 2, kernel: 'lanczos3' })
        .sharpen()
        .png().toBuffer();

      const { data: leftData } = await Tesseract.recognize(leftBuf, 'eng');
      const leftText = cleanRepLines(normalizeOcr(leftData.text));
      console.log(`[${id}] rep LEFT OCR · ${leftText.length} chars`);
      console.log(`[${id}] rep LEFT preview:\n${leftText.slice(0, 500)}\n`);
      repOcrTexts.push(leftText);

      const { data: rightData } = await Tesseract.recognize(rightBuf, 'eng');
      const rightText = cleanRepLines(normalizeOcr(rightData.text));
      console.log(`[${id}] rep RIGHT OCR · ${rightText.length} chars`);
      console.log(`[${id}] rep RIGHT preview:\n${rightText.slice(0, 500)}\n`);
      repOcrTexts.push(rightText);

    } catch (repErr) {
      console.warn(`[${id}] rep image OCR failed (non-fatal): ${repErr.message}`);
    }
  }

  // ── 5. Parse prices from main OCR text ──────────────────────────────────
  try {
    const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
    const slaughter = { beef: null, crossbred: null, holstein: null };
    const feeder    = { beef: null, crossbred: null, holstein: null, liteTest: false };
    const feederWeights = [];
    let reportDate = null;
    let saleDay = null;
    let liteTestNote = null;

    const hogs = { marketHogs: null, sows: null, boars: null };
    let inHogSection = false;

    let inFeederSection = false;
    let feederBeefHeader = -1;
    let feederHolsteinHeader = -1;
    let currentFeederTypes = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      // Report date
      if (!reportDate && /market\s*report/i.test(line)) {
        const dm = line.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (dm) {
          const mm = dm[1].padStart(2, '0');
          const dd = dm[2].padStart(2, '0');
          const yyyy = dm[3].length === 2 ? '20' + dm[3] : dm[3];
          reportDate = `${yyyy}-${mm}-${dd}`;
          console.log(`[${id}] report date: ${reportDate}`);
        }
      }

      // Sale day
      if (!saleDay && /^(monday|tuesday|wednesday|thursday|friday|saturday)\s*[-–]\s*cattle/i.test(line)) {
        saleDay = line.match(/^(monday|tuesday|wednesday|thursday|friday|saturday)/i)[1];
        saleDay = saleDay.charAt(0).toUpperCase() + saleDay.slice(1).toLowerCase();
        console.log(`[${id}] sale day: ${saleDay}`);
      }

      // Lite test note
      if (!liteTestNote && /lite\s*test\s*see/i.test(line)) {
        const m = line.match(/lite\s*test\s*see\s+(.*)/i);
        if (m) {
          liteTestNote = 'lite test see ' + m[1].trim();
          console.log(`[${id}] lite test note: ${liteTestNote}`);
        }
      }

      // Slaughter headers
      if (/finished\s+beef\s+steers/i.test(line)) {
        const price = extractPriceSkipWeights(line);
        if (price !== null) { slaughter.beef = price; console.log(`[${id}] slaughter.beef = ${price}`); }
      }
      else if (/finished\s+dairy[\s-]*x/i.test(line) || /dairy[\s-]*x\s+steers/i.test(line)) {
        const price = extractPriceSkipWeights(line);
        if (price !== null) { slaughter.crossbred = price; console.log(`[${id}] slaughter.crossbred = ${price}`); }
      }
      else if (/finished\s+dairy\s+steers/i.test(line)) {
        const price = extractPriceSkipWeights(line);
        if (price !== null) { slaughter.holstein = price; console.log(`[${id}] slaughter.holstein = ${price}`); }
      }

      // Feeder section
      if (/feeder\s+cattle/i.test(line)) {
        inFeederSection = true;
        console.log(`[${id}] entered feeder section at line ${i}`);
      }

      if (inFeederSection && /beef\s+steers\s*[&]\s*bulls/i.test(line)) {
        feederBeefHeader = i;
        currentFeederTypes = ['beef', 'crossbred'];
        console.log(`[${id}] feeder beef header at line ${i}: "${line}"`);
      }
      else if (inFeederSection && /beef\s+heifers/i.test(line) && !/finished/i.test(line)) {
        currentFeederTypes = ['beef', 'crossbred'];
        console.log(`[${id}] feeder beef heifers header at line ${i}`);
      }
      else if (inFeederSection && /beef\s+steers/i.test(line) && !/finished/i.test(line)) {
        feederBeefHeader = i;
        currentFeederTypes = ['beef', 'crossbred'];
        const price = extractPriceSkipWeights(line);
        if (price !== null) { feeder.beef = price; console.log(`[${id}] feeder.beef = ${price} (same line)`); }
      }

      if (inFeederSection && /dairy\s+steers/i.test(line) && !/finished/i.test(line)) {
        feederHolsteinHeader = i;
        currentFeederTypes = ['holstein'];
        const price = extractPriceSkipWeights(line);
        if (price !== null) { feeder.holstein = price; console.log(`[${id}] feeder.holstein = ${price} (same line)`); }
      }

      // Feeder weight ranges with upto prices
      if (inFeederSection && currentFeederTypes && /upto/i.test(line)) {
        const wm = line.match(/(\d{2,4})\s*[-–]\s*(\d{2,4})\s*[%#]/);
        const price = extractUptoPrice(line);
        if (wm && price !== null) {
          const range = wm[1] + '–' + wm[2] + '#';
          feederWeights.push({ range, price, types: [...currentFeederTypes] });
          console.log(`[${id}] feederWeight: ${range} → ${price} [${currentFeederTypes}]`);
        }
        if (price !== null) {
          if (feeder.beef === null && currentFeederTypes.includes('beef')) {
            feeder.beef = price;
            console.log(`[${id}] feeder.beef = ${price} (from upto line ${i})`);
          }
          if (feeder.holstein === null && currentFeederTypes.includes('holstein')) {
            feeder.holstein = price;
            console.log(`[${id}] feeder.holstein = ${price} (from upto line ${i})`);
          }
        }
      }

      // Lite test flag
      if (inFeederSection && /lite/i.test(lower)) {
        feeder.liteTest = true;
        console.log(`[${id}] feeder.liteTest = true`);
      }

      // ── Hog section (Wednesday cattle+hogs report) ──────────────────────
      if (/hog|swine/i.test(lower) && /market|butcher/i.test(lower)) {
        inHogSection = true;
        inFeederSection = false;
        console.log(`[${id}] entered hog section at line ${i}`);
      }

      if (inHogSection) {
        // Market hogs / butcher hogs
        if (/market\s*hog|butcher/i.test(lower) && hogs.marketHogs === null) {
          const price = extractLinePrice(line);
          if (price !== null) { hogs.marketHogs = price; console.log(`[${id}] hogs.marketHogs = ${price}`); }
        }
        // Sows
        if (/sow/i.test(lower) && hogs.sows === null) {
          const price = extractLinePrice(line);
          if (price !== null) { hogs.sows = price; console.log(`[${id}] hogs.sows = ${price}`); }
        }
        // Boars
        if (/boar/i.test(lower) && hogs.boars === null) {
          const price = extractLinePrice(line);
          if (price !== null) { hogs.boars = price; console.log(`[${id}] hogs.boars = ${price}`); }
        }
      }
    }

    // Derive crossbred feeder from beef feeder
    if (feeder.beef !== null) {
      feeder.crossbred = parseFloat(
        (feeder.beef - SLAUGHTER_DISC.crossbred * FEEDER_FACTOR).toFixed(2)
      );
      console.log(`[${id}] feeder.crossbred = ${feeder.crossbred} (derived)`);
    }

    const hasSlaughter = Object.values(slaughter).some(v => v !== null);
    const hasFeeder    = feeder.beef !== null || feeder.holstein !== null;
    console.log(`[${id}] parse — hasSlaughter=${hasSlaughter} hasFeeder=${hasFeeder}`);

    if (!hasSlaughter && !hasFeeder) {
      throw new Error('OCR returned no usable prices');
    }

    // ── 6. Parse Representative Sales ───────────────────────────────────────
    const repSales = { finished: [], feeder: [], bulls: [], cows: [] };
    try {
      const allRepText = repOcrTexts.join('\n');
      if (allRepText.length > 0) {
        console.log(`[${id}] parsing rep sales from ${repOcrTexts.length} OCR halves · ${allRepText.length} chars`);

        const repLines = allRepText.split('\n').map(l => l.trim()).filter(Boolean);
        let currentCategory = null;

        const SECTION_RE = /Representative\s+Sales[:\s]+(.+)/i;
        const SALE_ROW_RE = /([A-Za-z][A-Za-z\s.]+,\s*[A-Za-z]{2,3})\s+(\d{1,3})\s+([A-Za-z][A-Za-z\s\/]{2,20}?)\s+(\d{3,4})\s+(\d{3,6}(?:\.\d{2})?)/;
        const SALE_ROW_FALLBACK_RE = /([A-Za-z][A-Za-z\s.]+,\s*[A-Za-z]{2,3})\s+(\d{1,3})\s+([A-Za-z][A-Za-z\s\/]{2,20}?)\s+\S+\s+(\d{4,6}(?:\.\d{2})?)/;
        const HOG_DESC_RE = /MKT|HOG|SOW|BOAR|GILT|PIG|PORK/i;

        function mapCategory(secText) {
          if (/finish/i.test(secText))          return 'finished';
          if (/feeder\s*cattle/i.test(secText)) return 'feeder';
          if (/calve/i.test(secText))           return 'feeder';
          if (/market\s*cow/i.test(secText))    return 'cows';
          if (/market\s*bull/i.test(secText))   return 'bulls';
          if (/^bull/i.test(secText))           return 'bulls';
          return null;
        }

        for (const rline of repLines) {
          const secMatch = rline.match(SECTION_RE);
          if (secMatch) {
            const cat = mapCategory(secMatch[1].trim().toLowerCase());
            if (cat) currentCategory = cat;
            console.log(`[${id}] rep section: ${currentCategory} ("${rline.slice(0, 60)}")`);
            continue;
          }

          if (/^location|^description|^city/i.test(rline)) continue;
          if (!currentCategory) continue;

          let location, qty, desc, weight, rawPrice;
          const m = rline.match(SALE_ROW_RE);
          if (m) {
            location = m[1].trim(); qty = parseInt(m[2]) || 1; desc = m[3].trim();
            weight = parseInt(m[4]); rawPrice = m[5];
            if (weight < 200 || weight > 2500) continue;
          } else {
            const fb = rline.match(SALE_ROW_FALLBACK_RE);
            if (!fb) continue;
            location = fb[1].trim(); qty = parseInt(fb[2]) || 1; desc = fb[3].trim();
            weight = null; rawPrice = fb[4];
            console.log(`[${id}] rep fallback match (no weight): ${location} ${qty} ${desc} $${rawPrice}`);
          }

          const price = normalizePrice(rawPrice);
          if (price === null) continue;
          if (HOG_DESC_RE.test(desc)) continue;

          const descUpper = desc.toUpperCase();
          let cattleType = 'beef';
          if (/HOL/i.test(descUpper)) cattleType = 'holstein';
          else if (/XBRD|BKRD|BWF|RWF|CROSS/i.test(descUpper)) cattleType = 'crossbred';

          let sex = 'steer';
          if (/ST\/H/.test(descUpper)) sex = 'mixed';
          else if (/HFR/.test(descUpper)) sex = 'heifer';
          else if (/BULL|BUL/.test(descUpper)) sex = 'bull';
          else if (/COW/.test(descUpper)) sex = 'cow';

          repSales[currentCategory].push({ location, qty, desc, cattleType, sex, weight, price });
        }

        console.log(`[${id}] rep sales — finished: ${repSales.finished.length}, feeder: ${repSales.feeder.length}, bulls: ${repSales.bulls.length}, cows: ${repSales.cows.length}`);
      } else {
        console.log(`[${id}] no rep OCR text — skipping rep sales parse`);
      }
    } catch (repErr) {
      console.warn(`[${id}] rep sales parse error (non-fatal): ${repErr.message}`);
    }

    // ── 7. Build weight-class averages ──────────────────────────────────────
    const finishByWeight = {};
    const feederByWeight = {};
    const headCount = { finished: 0, feeder: 0, bulls: 0, cows: 0 };

    for (const sale of repSales.finished) {
      headCount.finished += sale.qty;
      if (sale.weight === null) continue;
      const bucket = Math.floor(sale.weight / 100) * 100;
      const range = `${bucket}-${bucket + 99}`;
      if (!finishByWeight[range]) finishByWeight[range] = {};
      if (!finishByWeight[range][sale.cattleType]) finishByWeight[range][sale.cattleType] = { sum: 0, count: 0 };
      finishByWeight[range][sale.cattleType].sum += sale.price * sale.qty;
      finishByWeight[range][sale.cattleType].count += sale.qty;
    }

    for (const sale of repSales.feeder) {
      headCount.feeder += sale.qty;
      const bucket = sale.weight !== null ? Math.floor(sale.weight / 100) * 100 : null;
      const range = bucket !== null ? `${bucket}-${bucket + 99}` : 'mixed';
      if (!feederByWeight[range]) feederByWeight[range] = {};
      if (!feederByWeight[range][sale.cattleType]) feederByWeight[range][sale.cattleType] = { sum: 0, count: 0 };
      feederByWeight[range][sale.cattleType].sum += sale.price * sale.qty;
      feederByWeight[range][sale.cattleType].count += sale.qty;
    }

    const bullsByWeight = {};
    for (const sale of repSales.bulls) {
      headCount.bulls += sale.qty;
      const bucket = sale.weight !== null ? Math.floor(sale.weight / 100) * 100 : null;
      const range = bucket !== null ? `${bucket}-${bucket + 99}` : 'mixed';
      if (!bullsByWeight[range]) bullsByWeight[range] = { sum: 0, count: 0 };
      bullsByWeight[range].sum += sale.price * sale.qty;
      bullsByWeight[range].count += sale.qty;
    }

    const cowsByWeight = {};
    for (const sale of repSales.cows) {
      headCount.cows += sale.qty;
      const bucket = sale.weight !== null ? Math.floor(sale.weight / 100) * 100 : null;
      const range = bucket !== null ? `${bucket}-${bucket + 99}` : 'mixed';
      if (!cowsByWeight[range]) cowsByWeight[range] = { sum: 0, count: 0 };
      cowsByWeight[range].sum += sale.price * sale.qty;
      cowsByWeight[range].count += sale.qty;
    }

    // Convert to averages
    const finishWeightAvgs = [];
    for (const [range, types] of Object.entries(finishByWeight)) {
      for (const [type, data] of Object.entries(types)) {
        finishWeightAvgs.push({ range: range + ' lbs', type, avgPrice: parseFloat((data.sum / data.count).toFixed(2)), head: data.count });
      }
    }
    finishWeightAvgs.sort((a, b) => parseInt(a.range) - parseInt(b.range));

    const feederWeightAvgs = [];
    for (const [range, types] of Object.entries(feederByWeight)) {
      for (const [type, data] of Object.entries(types)) {
        feederWeightAvgs.push({ range: range === 'mixed' ? 'mixed wt' : range + ' lbs', type, avgPrice: parseFloat((data.sum / data.count).toFixed(2)), head: data.count });
      }
    }
    feederWeightAvgs.sort((a, b) => parseInt(a.range) - parseInt(b.range));

    const bullsWeightAvgs = [];
    for (const [range, data] of Object.entries(bullsByWeight)) {
      bullsWeightAvgs.push({ range: range === 'mixed' ? 'mixed wt' : range + ' lbs', avgPrice: parseFloat((data.sum / data.count).toFixed(2)), head: data.count });
    }
    bullsWeightAvgs.sort((a, b) => parseInt(a.range) - parseInt(b.range));

    const cowsWeightAvgs = [];
    for (const [range, data] of Object.entries(cowsByWeight)) {
      cowsWeightAvgs.push({ range: range === 'mixed' ? 'mixed wt' : range + ' lbs', avgPrice: parseFloat((data.sum / data.count).toFixed(2)), head: data.count });
    }
    cowsWeightAvgs.sort((a, b) => parseInt(a.range) - parseInt(b.range));

    console.log(`[${id}] head count — finished: ${headCount.finished}, feeder: ${headCount.feeder}, bulls: ${headCount.bulls}, cows: ${headCount.cows}`);
    console.log(`[${id}] finish weight avgs: ${finishWeightAvgs.length} buckets`);
    console.log(`[${id}] feeder weight avgs: ${feederWeightAvgs.length} buckets`);
    console.log(`[${id}] bulls weight avgs: ${bullsWeightAvgs.length} buckets`);
    console.log(`[${id}] cows weight avgs: ${cowsWeightAvgs.length} buckets`);

    // Only include hogs object if any hog prices were found
    const hasHogs = Object.values(hogs).some(v => v !== null);

    return {
      slaughter, feeder, feederWeights, reportDate, saleDay, liteTestNote,
      repSales: { finishWeightAvgs, feederWeightAvgs, bullsWeightAvgs, cowsWeightAvgs, headCount },
      hogs: hasHogs ? hogs : null,
      source: 'scraped', error: null
    };

  } catch (parseErr) {
    console.error(`[${id}] PARSE ERROR: ${parseErr.message}`);
    return { slaughter: null, feeder: null, source: 'fetch_failed', error: parseErr.message };
  }
}

module.exports = { parse };
