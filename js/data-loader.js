// Load pre-scraped barn data from GitHub Actions bot
// Self-executing: loads data immediately AND patches the CORS scraper to skip
(async function() {
  try {
    const r = await fetch('data/prices/index.json');
    if (!r.ok) throw new Error('fetch ' + r.status);
    const index = await r.json();
    for (const entry of index) {
      const b = BARNS_DATA[entry.id];
      if (!b || entry.source !== 'scraped') continue;
      if (entry.slaughter) {
        b.finishPrices = { beef: priceObj(entry.slaughter.beef), crossbred: priceObj(entry.slaughter.crossbred), holstein: priceObj(entry.slaughter.holstein) };
        if (entry.slaughter.beef != null) b.basePrice = priceMid(entry.slaughter.beef);
      }
      // Store scraped feeder prices per type (as {low, high} ranges)
      if (entry.feeder) {
        b._feederScraped = { beef: priceObj(entry.feeder.beef), crossbred: priceObj(entry.feeder.crossbred), holstein: priceObj(entry.feeder.holstein), liteTest: entry.feeder.liteTest ?? false };
      }
      // Load feeder weight ranges into b.feederWeights (used by drawer detail table)
      if (entry.feederWeights && entry.feederWeights.length) {
        // Dedup: keep highest price per range+types combo
        var seen = {};
        var deduped = [];
        entry.feederWeights.forEach(function(fw) {
          var key = fw.range + '|' + (fw.types || []).sort().join(',');
          if (!seen[key] || fw.price > seen[key].price) {
            seen[key] = fw;
          }
        });
        for (var k in seen) deduped.push(seen[k]);
        // Sort by weight low bound
        deduped.sort(function(a, b) {
          var aNum = parseInt(a.range) || 0;
          var bNum = parseInt(b.range) || 0;
          return aNum - bNum;
        });
        b.feederWeights = deduped;
        console.log('[barn-data] loaded ' + deduped.length + ' feeder weight ranges for ' + entry.id + ' (deduped from ' + entry.feederWeights.length + ')');
      }
      b.dataSource = 'live';
      b._scrapeError = null;
      if (entry.saleDay) b.saleDay = entry.saleDay;
      if (entry.liteTestNote) b.liteTestNote = entry.liteTestNote;
      if (entry.repSales) b.repSales = entry.repSales;
      // Per-category sale day and date (slaughter/feeder may come from different days)
      if (entry.slaughterSaleDay) b.slaughterSaleDay = entry.slaughterSaleDay;
      if (entry.slaughterDate) b.slaughterDate = entry.slaughterDate;
      if (entry.feederSaleDay) b.feederSaleDay = entry.feederSaleDay;
      if (entry.feederDate) b.feederDate = entry.feederDate;
      // Report date: use slaughter date, then feeder date, then lastSuccess
      var dateStr = entry.slaughterDate || entry.feederDate || entry.lastSuccess;
      if (dateStr) {
        const d = new Date(dateStr + 'T12:00:00');
        b.reportDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      // Per-category formatted dates for display
      if (entry.slaughterDate) {
        const d = new Date(entry.slaughterDate + 'T12:00:00');
        b.slaughterReportDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
      if (entry.feederDate) {
        const d = new Date(entry.feederDate + 'T12:00:00');
        b.feederReportDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }
    buildBarnTable();
    console.log('[barn-data] loaded scraped prices from index.json');
  } catch (e) {
    console.warn('[barn-data] could not load index.json:', e.message);
  }
})();

// Patch: replace CORS scraper so it skips when pre-scraped data is loaded
var _origLoadCentral = loadCentralLivestockData;
loadCentralLivestockData = async function() {
  if (BARNS_DATA.central.finishPrices && BARNS_DATA.central.dataSource === 'live') {
    console.log('[central] skipping CORS scraper — pre-scraped data already loaded');
    return;
  }
  return _origLoadCentral();
};

// Patch: after buildBarnTable renders, update feeder cells for barns with scraped feeder data
var _origBuildBarnTable = buildBarnTable;
buildBarnTable = function() {
  _origBuildBarnTable();
  // Now patch feeder avg cells for barns with scraped feeder prices
  var type = typeof cattleType !== 'undefined' ? cattleType : 'beef';
  var keys = Object.keys(BARNS_DATA);
  keys.forEach(function(key) {
    var b = BARNS_DATA[key];
    if (!b._feederScraped && !(b.feederWeights && b.feederWeights.length)) return;
    var feederPrice = null;
    var feederSrc = 'live'; // track actual source

    // BEST: head-weighted average from rep sales feeder data
    if (b.repSales && b.repSales.feederWeightAvgs && b.repSales.feederWeightAvgs.length) {
      var typeRows = b.repSales.feederWeightAvgs.filter(function(r) { return r.type === type; });
      var totalHead = 0, weightedSum = 0;
      typeRows.forEach(function(r) { totalHead += r.head; weightedSum += r.avgPrice * r.head; });
      if (totalHead > 0) feederPrice = weightedSum / totalHead;
    }

    // FALLBACK: simple average of feederWeights summary prices (barn-posted, not live sales)
    if (feederPrice === null && b.feederWeights && b.feederWeights.length) {
      var sum = 0, count = 0;
      b.feederWeights.forEach(function(fw) {
        if (fw.types && fw.types.includes(type)) {
          sum += fw.price;
          count++;
        }
      });
      if (count > 0) { feederPrice = sum / count; feederSrc = 'barn'; }
    }

    // LAST RESORT: scraped feeder price (may be {low, high})
    var feederDisplay = null;
    if (feederPrice === null && b._feederScraped && b._feederScraped[type] != null) {
      feederDisplay = formatRange(b._feederScraped[type]);
      feederPrice = priceHigh(b._feederScraped[type]);
      feederSrc = 'barn';
    }
    if (feederPrice == null) return;
    if (!feederDisplay) feederDisplay = feederPrice.toFixed(2);
    // Find the barn row and update its feeder cell
    var row = document.querySelector('tr.barn-row[data-key="' + key + '"]');
    if (!row) return;
    var cells = row.querySelectorAll('td.cash-price-cell');
    if (cells.length >= 2) {
      var dateStr = b.feederReportDate ? ' <span style="font-size:10px;color:var(--txt3);white-space:nowrap;">' + b.feederReportDate + (b.feederSaleDay ? ' ' + b.feederSaleDay.slice(0,3) : '') + '</span>' : '';
      var aging = false;
      if (feederSrc === 'live' && b.feederDate) {
        aging = (Date.now() - new Date(b.feederDate + 'T12:00:00').getTime()) / 86400000 > 8;
      }
      var badgeClass = feederSrc !== 'live' ? 'barn-src-barn' : aging ? 'barn-src-aging' : 'barn-src-live';
      var badgeLabel = feederSrc !== 'live' ? feederSrc.toUpperCase() : aging ? 'AGING' : 'ACTUAL';
      var badgeTip = feederSrc !== 'live' ? 'Barn-posted summary price, not from live sale data' : aging ? 'Scraped from barn report but more than 8 days old' : 'Price scraped directly from this barn\u2019s report';
      cells[1].innerHTML = feederDisplay + '&cent; <span class="barn-src-badge ' + badgeClass + '" title="' + badgeTip + '">' + badgeLabel + '</span>' + dateStr;
    }
  });
};
