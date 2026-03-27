# Build Log — grow27

Chronological record of what was built, when, and why.

---

## desktop/v0.2.0 — Setup Wizard + SQLCipher (2026-03-27T00:00Z)

### Desktop App — Full Setup Wizard (dev branch)
- Fixed scaffold: `main.rs` referenced `app_lib` → corrected to `grow27_lib`; identifier `com.grow27.app` → `com.grow27.desktop`; `frontendDist` scoped to `./www` to exclude `desktop/target/`
- Added SQLCipher: `rusqlite` with `bundled-sqlcipher-vendored-openssl`. Required Strawberry Perl for OpenSSL build on Windows. First compile ~10 min; subsequent builds ~20s cached.
- Full v1 schema migrations (3 migrations): all type tables, operations, sites, pens, parties, animals, transaction_groups, transaction_animals, health_events, market_cache — all indexes + type seeds
- Session snapshot (Layer 1 backup): copies `grow27.db` → `backups/grow27_YYYY-MM-DD_HH.db` before DB opens, keeps last 7
- Dev key placeholder: generates random 32-byte hex key, stores in `.devkey` (TODO: replace with Windows Credential Manager)
- **Setup Wizard — 7 steps:** operation name → first site → branding (accent + theme) → auth mode → admin user (Argon2id password hash) → backup destination → recovery file (AES-256-GCM + Argon2id KDF, 5-word farm passphrase)
- Welcome screen before step 1 with brand copy and "Let's get started" button
- Personalized completion screen: fetches admin name + operation name from DB, displays "Welcome, Michael. FarmName is ready to capture its first animal in #27Herd."
- Animated logo on completion screen: SVG crop stalks grow upward, leaves branch off as stalks pass them, teal tips appear, grow27 wordmark fades in, then welcome text — ~4s total sequence
- Step 6 (backup): native folder picker via `tauri-plugin-dialog`, pre-populated with detected OneDrive/Documents path
- Step 5 labels clarified: "Your name" (display) / "Login name" (credential)
- Dark-theme logo variant: `www/assets/logo-dark.svg` — stalk strokes brightened to `#f4f4f2` for dark bg
- Text contrast: `--text` → `#f4f4f2`, `--muted` → `#c0c0bc`
- `withGlobalTauri: true` in tauri.conf.json — enables `window.__TAURI__.core.invoke` in vanilla JS
- Queued: Windows Credential Manager key management (keyring crate), Herd module UI

---

## desktop/v0.1.0 — Tauri Scaffold (2026-03-27T00:00Z)

### Tauri Desktop App — Initial Scaffold (dev branch)
- Installed Rust 1.94.1 + Cargo, tauri-cli v2.10.1
- Ran `cargo tauri init` — scaffolded Tauri 2 project
- Renamed `src-tauri/` → `desktop/` to match STRATEGY.md repo structure
- Updated `desktop/tauri.conf.json`: identifier → `com.grow27.app`, window size → 1280×800
- Updated `desktop/Cargo.toml`: package name → `grow27`, lib name → `grow27_lib`
- Next: first debug build verification, then add SQLCipher + schema migrations

---

## v1.143 (2026-03-27T00:00Z)

### Service Worker — Yahoo Finance Cache Bug Fix
- **`sw.js`** — added `finance.yahoo.com`, `allorigins.win`, `corsproxy.io`, and `codetabs.com` to the `isApi` network-only list. Previously these fell into the "cache first" handler, causing mobile PWA to serve a 2-day-old Yahoo Finance response. Symptom: CBOT corn card showed wrong color (red instead of yellow) and stale timestamp (Mar 25 instead of Mar 27), even though the scraped price value was correct.

---

## v1.138–v1.140 (2026-03-27T02:26Z)

### Scraper Workflow Migration to Main
- **Simplified all 3 production workflows** (barns, grain, futures) — scrapers now run on `main` and commit data directly to `main`. Removed the cross-branch copy step that committed to UserUpdates first then copied to main.
- **`push-main.ps1` auto-syncs data** — before merging UserUpdates→main, the script now pulls latest `data/prices/` from main so scraped history isn't lost during promotion.
- **New `test-scrapers.yml`** — dry-run dev workflow triggered on push to UserUpdates (path-filtered: `scripts/`, config, workflow files). Runs all 3 scrapers in parallel with no commit. Also available via `workflow_dispatch`.
- **Staleness alerts** — `scripts/check-staleness.js` runs at the end of each scraper workflow. If any active source hasn't updated within its threshold (barns: 7 days, grain/futures: 3 days), the workflow fails and GitHub sends a failure notification email. Skips `pending` and `directory` entries.
- **Upgraded** `actions/checkout@v3` → `@v4` across all workflows.

### Blue Earth Stockyard — Directory Entry
- **Added to `barns-config.json`** — directory-only entry (no `reportUrl`, no parser). `"status": "directory"`.
- **Added to `BARNS_DATA` + `BARN_DATA`** in `markets.js` — shows in barn directory with address, phone, sale schedule, CattleUSA + Facebook links. Filtered from price table, barn select, auction charts, and USDA/CME fallback pricing.
- **About page** — added Blue Earth as "Directory only" in cattle barn table.

### About Page Data Sources
- **Status colors** — Active/Live → gold (`--corn`), Pending → blue (`--dairy`), Disabled → red (`--down`), Directory only → muted (`--txt3`). Previously all used undefined `--green` variable.
- **POET added** — listed as Disabled with note about Gradable WAF blocking automated access.

---

## v1.128 (2026-03-27T00:00Z)

### Sleepy Eye Auction Market — Parser + Index Fixes
- **Feeder entry selection** — `buildIndexRow` now picks the entry with the most feeder weight brackets (real "feeder sale day") instead of just the most recent entry with any feeder data. Fixes Sleepy Eye showing 7-head Wednesday feeders over 342-head Saturday feeders.
- **Split detail repSales by category** — finish weight table uses slaughter entry's repSales, feeder weight table uses feeder entry's repSales. Previously used one `detailRepSales` matched to slaughter date, hiding Holstein feeder data from the Saturday sale.
- **CBOT futures timestamps** — added "CBOT Futures Timestamps" section to How To guide explaining day session (8:30 AM – 1:20 PM CT) vs electronic session (7:00 PM – 7:45 AM CT). Tooltip on section divider. Updated About data sources note.
- **Sleepy Eye status** — updated About page from Pending to Active with Wed (slaughter) + Sat (feeder) sale days.

---

## v1.117–v1.125 (2026-03-26)

### Al-Corn Clean Fuel Grain Parser
- **Built `scripts/grain/alcorn.js`** — parser for Al-Corn Clean Fuel (Claremont MN), corn only
- **CIH widget** (not DTN) — `table.cih-table` inside `div.cih-loc-card` containers, `select#cih-location-filter` to isolate Al-Corn from HCP location
- Dynamic column mapping from header row: Delivery | Futures (month+price in same cell) | Change | Basis | Bid (cash)
- Futures cell splitting: `"May 26\n \n 4.6425"` → `futuresMonth: "May26"`, `cbot: "4.6425"`
- Added `GRAIN_SCRAPE_MAP` entry: `alcorn` → `alcorn` source / `claremont` location
- 13 delivery months captured (Mar26–May27), basis + futures month + CBOT price stored
- Green datetime badge now showing on live site

### POET Biorefining — Shelved
- **Built `scripts/grain/poet.js`** — parser for Gradable platform (React SPA), two locations (Bingham Lake, Albert Lea)
- **Blocked by Gradable WAF** — returns 403 to headless browsers from datacenter IPs despite permissive `robots.txt`
- **Shelved** — parser disabled in `grain-config.json`, not worth bypassing bot protection
- POET Bingham Lake (Area 1) and Albert Lea (Area 2) remain as curated elevators with estimated basis

### Estimated Buyer Badges
- **`est.` badge** on cash price table — non-scraped buyers now show a muted `est.` tag next to cash price
- **Basis hidden** for estimated rows — basis column left blank when not from actual scraped data (was showing colored basis indistinguishable from real data)
- Scraped buyers keep green datetime badge + colored basis as before

### About Page Rewrite
- **Full brand-voice rewrite** — origin story ("these aren't my numbers"), The Platform, Why It's Free, Built with AI, Where the Data Comes From
- **Data sources updated** — added New Vision (22 loc), Crystal Valley (7 loc), Al-Corn (1 loc), Jennie-O reordered. Fixed Lanesboro and Rock Creek from Pending → Active
- **Section descriptions** — "Scraped directly from each elevator's posted bids" intro for grain, "Scraped from each barn's posted market reports" for cattle
- **Body text brightened** — `font-weight:500` + `color:#fff` for readability on dark background

### Page Loader Overhaul
- **Logo size** 64px → 360px — fills the screen
- **Animation speed** 1.2s → 7s — slow, deliberate grow from bottom up
- **Background opacity** 75% → 95% — near-opaque during load
- **Rotating taglines** — 5 brand taglines from BRAND.md fade in/out below logo in amber italic, random start, 2.8s per tagline
- **Icon source** — switched from 192px (stretched) to 512px (downscaled to 360px, crisp)
- **Tagline color** — bright gold `#e8b830` to match perceived brightness of logo "27"
- Loader still cuts immediately when data loads — no waiting for animation to complete

### How To Updates
- **Grain** — added `est.` badge explanation
- **Cattle** — added Charts section (Futures view with 5yr history/seasonal, Auction view with multi-barn overlay/sale calendar)

---

## v1.116 (2026-03-25)

### Cattle Charts Overhaul
- **Replaced fake chart data with real Yahoo Finance historical data** — `genHistory()` random-walk charts replaced with actual CME daily closes
- **Server-side futures scraper** — `scripts/scrape-futures-history.js` fetches 5-year daily data for 6 tickers (LE, GF, ZC, ZS, DC, ZM) + 5-year monthly for seasonal analysis, writes `data/prices/futures-history.json` (~264KB)
- **GitHub Actions workflow** — `.github/workflows/scrape-futures.yml` runs Mon–Fri after market close (5pm CT + 7pm CT backup), auto-pushes to UserUpdates and main
- **Frontend reads static JSON** — no CORS proxies for chart data. `loadFuturesHistory()` fetches once, cached for session. Instant range switching
- **Expanded range buttons** — 7D · 14D · 30D · 90D · 6M · 1Y · 2Y · 5Y (was 7D/30D/90D/180D)
- **X-axis labels** — `M/D` for short ranges, `Mon 'YY` for 6M+. Tooltips always show full date (e.g. "Mar 25, 2025")
- **Cattle type adjusts charts** — switching beef/crossbred/holstein applies discount offset to all chart series and spread
- **Real seasonal pattern** — computed from 5-year monthly CME LE=F closes, not hardcoded. Shows % deviation from each year's annual mean. Clearly labeled with year range and methodology

### Futures / Auction Chart Toggle
- **Futures view** — 4 CME charts (live cattle, feeder, corn, spread) + seasonal companion panel
- **Auction view** — combined multi-barn chart with all scraped barns overlaid (color-coded), slaughter/feeder toggle. Responds to cattle type selection
- **Auction insights** — top insight shows best barn and barn-to-barn spread. Detail panel shows per-barn trend analysis with latest price, % change, range position
- **Sale day calendar** — companion panel shows next 14 days of barn sales with sale type tags (Cattle, Slaughter, Feeder, Cattle & Hogs) per barn per day

### Data Reliability Fixes
- **Jennie-O forward contract filter** — Aug26 corn bid no longer appears in grain insight "best price" (flagged as `cornForward`). Still shows in buyer table with delivery tag
- **GF=F encoding fix** — removed `encodeURIComponent` from Yahoo URL path (was double-encoding `=` through CORS proxies). Added `getNearbyContract()` fallback to specific month symbol (e.g. `GFJ26.CME`)
- **Loading indicator** — spinner shown while futures charts load, hidden when data renders

### Spread Chart Context
- Added inline description to spread chart title: "finished sell price minus feeder buy price (¢/lb) · wider = more profit per head · narrower = tighter feed-and-finish margins"

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

### New Vision Cooperative Parser (v1.87–v1.101)
- Built `scripts/grain/newvision.js` — AgriCharts/Barchart two-stage widget parser
- Stage 1: Puppeteer loads page, discovers `agricharts.com/cashbids.php` script URL
- Stage 2: Server-side `https.get` fetches `cashbids-js.php` → extracts `var bids = [...]` JSON
- Parses structured JSON directly — no HTML scraping needed
- 22 locations across southern MN, corn + soybeans
- Stores `basisMonth` and `futuresMonth` (symbol) per bid for future basis+CBOT architecture
- Removed `location=` and `commodity=` filters from API URL to get all locations and commodities
- Uses API `price` field (4-decimal precision) for cash values
- Respects `robots.txt` Crawl-delay: 10s between all requests (3 total: page, stage-1, stage-2)
- Updated `grain-config.json` — 22 locations with overlap flags (AGP Sheldon, CHS Fairmont/Mankato) and ADM Mankato gap note
- Added `GRAIN_SCRAPE_MAP` entry: `newvision` → `mountain-lake`
- Workflow auto-discovers parser — no changes to `scrape-grain.yml`

### Frontend Updates (v1.86–v1.101)
- **Dynamic CBOT contract labels** — cards show actual contract month (e.g., "May 26 Corn") computed from date, not hardcoded "December Corn"
- **CBOT cards from scraped data** — when Stooq fails, CBOT cards pull futures values from scraped grain data (`parseCbotNotation` parses `"458'4"` → $4.585). Replaces stale hardcoded fallbacks
- **Green scrape badge** for New Vision — sources with scraped basis get datetime badge, not gray "Contract" badge. `cornScrapedBasis` / `soyScrapedBasis` flags distinguish
- **Cash-only badge cleanup** — removed "Contract" text from Jennie-O badge, shows just delivery month (e.g., "Aug26") with same gray styling
- **Blank scraped empties** — if a scraped source has no corn or soy bids, shows "—" instead of backfilling with default basis data. `elev.scraped` flag controls this
- Jennie-O about page update, doc updates for v1.83–v1.85

### Lanesboro Sales Commission Parser (v1.106–v1.114)
- Built `scripts/barns/lanesboro.js` — plain HTML parser for Webflow site (no OCR needed)
- Two sale days: Wednesday (slaughter) and Friday (feeder) via `reports[]` array in `barns-config.json`
- HTML structure: `<h5>` tag sequences with `[LABEL] [LOW] [To] [HIGH]` or `[UP] [To] [HIGH]` patterns
- Wednesday: parses beef (Choice/Select tiers), Holstein (Calf Fed tiers), market cows, market bulls
- Friday: parses feeder cattle by weight class (300-500, 500-700, 700-900), beef on dairy (crossbred), Holstein steers
- **Top Producers** (rep sales): Lanesboro publishes highlight sales, not exhaustive rep sales
  - `repSales.label = "topProducers"` — PWA can distinguish from other barns' exhaustive data
  - Walks h5 sequence for `NAME:/DESCRIPTION:/WEIGHT:/PRICE:` groups (8 tokens each)
  - Classification: price+weight heuristic (Webflow DOM structure prevents reliable section tracking)
  - Finished: price >= $200; Cows: price < $200 + weight >= 1800#; Bulls: price < $200 + weight < 1800#
- Page type detection: content-based (slaughter labels vs weight-class labels) — canonical URL returns `webflow.com`, nav text contains both "Wednesday" and "Friday"
- Date extraction: 4-strategy cascade — `<p>` with "head sold", `<p>` with year, h5 nodes, body text regex
- Fixed trend modal footer: `midpoints.length` instead of `entries.length` for sale day count (entries without data for selected category were inflating count)

### Yahoo Finance Migration (v1.115)
- **Replaced Stooq with Yahoo Finance** for all futures card data — Stooq was hitting daily rate limits ("Exceeded the daily hits limit"), cards always showed stale fallback values
- Tickers: `ZC=F` (corn), `ZS=F` (soy), `LE=F` (live cattle), `GF=F` (feeder cattle), `DC=F` (Class III milk), `ZM=F` (soybean meal)
- Deferred contracts built dynamically from `getContractMonths()` → `grainYahooSym()` (e.g. `ZCZ26.CBT` for Dec corn)
- **Cached batch fetch** — `prefetchYahoo()` fires all 8 tickers once at startup with 200ms stagger, results cached 10 min via `_yahooCache`. Individual loaders (`loadGrainPrices`, `loadCattlePrices`, `loadDairyPrices`, `loadFeedInputPrices`) all hit cache
- **Refresh spam protection** — any page reload within 10 min returns cached data, zero network requests
- **Exchange timestamps** — card "as of" times now use Yahoo's `regularMarketTime` (actual exchange timestamp) instead of `new Date()` page-load time
- Grain prices divided by 100 (Yahoo returns cents, cards display $/bu)
- Updated About page data source attribution from Stooq to Yahoo Finance
- Removed all Stooq references from `markets.js`

### CI/CD & Workflow (v1.54–v1.65)
- `scrape-barns.yml` — daily 4am + 7am CT cron, auto-commits to UserUpdates, copies data to main
- `scrape-grain.yml` — Mon–Fri 4am + 7am CT cron, same auto-push pattern
- `push-userupdates.ps1` — PS1 now respects pre-set `$MSG` variable (v1.65)
- `push-main.ps1` — promotes UserUpdates to main, no version bump
- Workflow installs: puppeteer, cheerio, tesseract.js, sharp
- Dropped node-fetch, uses Puppeteer for image download
