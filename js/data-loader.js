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
      if (entry.saleDays) b.saleDays = entry.saleDays;
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

// No longer need to patch buildBarnTable — markets.js handles _feederScraped and ranges directly
