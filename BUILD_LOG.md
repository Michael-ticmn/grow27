# Build Log — grow27

Chronological record of what was built, when, and why.

---

## v1.32–v1.65 (2026-03-22 → 2026-03-24)

### Barn Scraper & OCR Pipeline (v1.32–v1.37)
- Built `scripts/barns/central.js` — OCR-based parser using Tesseract.js + sharp
- Adaptive crop: scans header strip for Price/Location keywords to find table boundaries
- Upscale cropped images 2x + sharpen before OCR for better weight/price accuracy
- Word bounding-box extraction from HOCR for column detection
- Fallback regex for garbled OCR weights in feeder rep sales
- Strips right-table OCR noise after Price column in rep sales
- Bulls/cows column, weighted averages, `normalizePrice` 500 ceiling
- Feeder badge shows BARN instead of LIVE when using simple average

### Grain Scraper Parsers (v1.38–v1.53)
- **MVG** (`scripts/grain/mvg.js`) — Minnesota Valley Grain; rewrote for dynamic widget rendering; fallback to source parsing when Barchart quotes blocked; user-agent bypass for 403
- **AGP** (`scripts/grain/agp.js`) — Ag Partners; rewrote for dynamic widget rendering
- **Jennie-O** (`scripts/grain/jennieo.js`) — extracts displayNumber args from unexecuted script text; uses td+th selector for DataGrid cells; **disabled** (robots.txt)
- **CHS** (`scripts/grain/chs.js`) — discovery parser; reads stacked locations from page text; detects all location headers to prevent bid bleed
- **CFS** (`scripts/grain/cfs.js`) — Central Farm Service; DTN Cashbid widget; 13 locations

### PWA Frontend (v1.38–v1.65)
- Grain prices tab: CBOT futures + local cash bids table with per-location data
- Grain insight badges with local datetime on ACTUAL data
- Cattle prices: barn table, barn directory, locker directory
- Dairy prices: charts, margin calc, plant directory
- Margin calculators: corn/soy toggle, cattle, dairy
- Canvas-based historical + seasonal charts
- Elevator/buyer directory with geolocation-based sorting
- Weather display for 5 regional cities + user location
- Mobile responsive (css/mobile.css)
- Service worker caching with version-stamped cache name

### Rock Creek Barn Parser (v1.66–v1.82)
- Built `scripts/barns/rockcreek.js` — PDF-based parser for Rock Creek Livestock Market (Pine City MN)
- PDF discovery: scrapes reports page (`?page_id=348`) for links matching `YYYY-MM-DD-mr.pdf` pattern
- PDF download: native `https.get` (Puppeteer's `page.goto` returns Chrome PDF viewer HTML, not raw bytes)
- Text extraction: `pdf-parse@1.1.1` pinned (v2 has breaking class-based API)
- Two-column PDF layout: full-text regex matching instead of line-by-line section parsing
- Slaughter prices: "Day Choice & Prime" pattern × 3 (beef steers, beef heifers, holstein)
- Feeder weights: custom `normalizeFeederPrice` (allows up to 600¢ for light calves), negative lookbehind to prevent left-column digit bleed
- Holstein vs beef feeder: wide ranges (400-800, 800-1100) = holstein, 100-lb increments = beef
- Steers vs heifers: tracked by occurrence order, heifers hidden in UI for now
- Rep sales: classified by description content (Cow/Bull/Steer) not section headers (two-column merge clobbers headers)
- Batch processing: `_batchEntries` array in parse result, orchestrator merges before main entry
- Three-phase date filter: DEV_MODE (2 PDFs), YTD catch-up, incremental
- Sale day derived from report date (not PDF header parsing)
- History cap removed (`MAX_HISTORY = Infinity`) — monitor site speed as files grow
- Added `pdf-parse@1.1.1` to `scrape-barns.yml` workflow deps
- UI: feeder low–high ranges, "— hd" format, sale day display in summary row

### Jennie-O Parser Rewrite (v1.83–v1.85)
- Rewrote `scripts/grain/jennieo.js` — switched from blocked aghostportal.com to farmbucks.com
- Simple HTML table parser targeting `#gpl-table-2-yellow-corn` — no widgets or dynamic loading
- Carry-forward location matching for grouped table rows (location name only on first row per group)
- Cash-only source (no basis/futures from farmbucks) — 4 MN locations: Atwater, Dawson, Faribault, Perham
- Dropped Barron Mill (WI location, not on farmbucks)
- Updated `grain-config.json` — removed `disabled` flag, new URL, removed `locId` fields
- Frontend: cash-only overlay fires on `cash != null` (not just `basis != null`)
- Contract badge: shows "Contract / Aug26" (delivery month) in place of scrape datetime badge
- Basis column hidden for cash-only sources
- Directory card: shows "CORN CASH $4.25" with delivery label instead of basis block
- Added `GRAIN_SCRAPE_MAP` entry mapping `jennyo` elevator to `jennieo` source / `faribault-mill`
- Generic disabled elevator pattern added to cash table + directory (for future use)

### CI/CD & Workflow (v1.54–v1.65)
- `scrape-barns.yml` — daily 4am + 7am CT cron, auto-commits to UserUpdates, copies data to main
- `scrape-grain.yml` — Mon–Fri 4am + 7am CT cron, same auto-push pattern
- `push-userupdates.ps1` — PS1 now respects pre-set `$MSG` variable (v1.65)
- `push-main.ps1` — promotes UserUpdates to main, no version bump
- Workflow installs: puppeteer, cheerio, tesseract.js, sharp
- Dropped node-fetch, uses Puppeteer for image download
