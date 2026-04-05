# Build Log — grow27

Chronological record of what was built, when, and why.

---

## v1.169 (2026-04-05T12:00Z)

### Watchdog Workflow Fix — Permissions for workflow_dispatch

**Watchdog workflow** failed daily with `403 Resource not accessible by integration` when trying to trigger missed scraper runs:
- Added `permissions: actions: write` to `watchdog.yml` — the default `GITHUB_TOKEN` lacked write access to dispatch other workflows
- Watchdog can now successfully trigger `workflow_dispatch` on barns, grain, futures, and robots-check workflows

---

## v1.168 (2026-04-02T15:13Z)

### Market Status Fix — Yahoo Fetch Failure on Mobile

**Market status indicator** showed incorrect state when Yahoo Finance fetch failed on mobile:
- Fixed `cbotMarketState()` to return correct market status even when Yahoo data is unavailable
- Prevents mobile users from seeing stale or wrong market state after a failed fetch

---

## v1.167 (2026-03-31T04:30Z)

### Delivery Month Filter, OSM Discovery, Request Prices

**Delivery month dropdown** — added a delivery month selector to the cash prices table:
- Dropdown defaults to current month, populated from all scraped bid delivery periods (Mar26–Oct27+)
- Switching months re-overlays bids from the full bid array stored on each elevator
- Buyers without a bid for the selected month show "Next: [month]" (only future months, not past)
- Non-standard delivery values normalized: "Cash"/"Spot" → current month, range formats like "Oct-Nov26" → first month ("Oct26")
- Full bid arrays (`_cornBids`, `_beanBids`) now stored on each elevator during scrape overlay

**OSM elevator discovery improvements:**
- Fixed `applyZip()` to call `discoverElevators()` — zip code changes now trigger new OSM searches
- Expanded Overpass keyword list: added `bunge`, `adm`, `cargill`, `gavilon`, `scoular`, `mill`, `terminal`, `storage`, `growmark`, `landus`, `badger`, `country visions`, `united cooperative`
- Removed unnamed silo discovery — anonymous `man_made=silo` nodes without names/contact are not actionable
- Removed hardcoded 'MN' state fallback for discovered elevators
- Single Overpass query (named facilities only) instead of parallel named+silo queries
- `filterElevatorsByRadius()` called after discovery to update status count

**Request Prices for discovered buyers:**
- Discovered elevators without scraped data show "Request Prices" button instead of estimated prices
- mailto link pre-fills facility name, location, and coordinates to Michael@ticmn.com
- Directory cards show same button with "no price data yet" note
- `submissions.md` updated with Price Requests tracking table

---

## v1.166 (2026-03-31T04:00Z)

### Mobile Fixes, Market Status Rewrite, CLAUDE.md Updates

**Location name layout fix** — location name (`#location-status`) was inside `loc-row-top` with `margin-left:auto`, causing it to be obscured by the Radius row below on narrow screens:
- Moved `#location-status` out of `loc-row-top` to its own row between input row and radius row in the `loc-bar` column layout
- Removed `margin-left:auto`, added `.loc-status:empty{display:none}` to collapse gap when empty

**Buyers dropdown mobile overflow fix** — the multi-select checklist was expanding past the right viewport edge on mobile:
- Changed `left:0` → `right:0` so dropdown anchors from the right edge of the Buyers button
- Added `max-width:calc(100vw - 24px)` to hard-cap width within viewport
- Reduced `min-width` from 250px to 220px to match grain basis dropdown

**Market status logic rewrite** — `cbotMarketState()` was reporting "Markets closed" during active Globex evening sessions:
- Root cause: old `toLocaleString` → `new Date()` round-trip for CT timezone conversion is unreliable on some mobile browsers (returns `Invalid Date`, all comparisons become `NaN`, falls through to `'closed'`)
- Replaced with `Intl.DateTimeFormat.formatToParts()` — standards-compliant, no string parsing
- Now models all 5 CBOT session windows explicitly: day session (8:30a–1:20p), evening/overnight (7p–7:45a), maintenance (7:45a–8:30a), daily break (1:20p–7p), weekend (Fri 1:20p–Sun 7p)
- Friday correctly has no evening Globex session after day close
- Sunday correctly opens Globex at 7 PM only

**Location name not appearing fix** — `updateLocationStatus()` was overwriting the city name with just a buyer count every time `filterElevatorsByRadius()` ran:
- Added `userLocName` variable to persist the resolved city name across filter updates
- `updateLocationStatus()` now displays both count and name (e.g., "3 buyers within 50 mi · St. James, MN")
- Fixed in all paths: zip entry, geolocation, default location, and `initLocation()` in app.js

**CLAUDE.md updates** — added `## Browser Usage` and `## Billing & API Usage` sections

---

## v1.165 (2026-03-31T02:00Z)

### UI Polish — Button Tabs, Location Bar, Yahoo Globex Fix

**Tab selectors restyled** — both subtabs (Grain/Cattle/Dairy) and inner tabs (Prices/Buyers/Charts…) redesigned as rounded bordered buttons:
- Subtabs: `border-radius:6px`, `--bg2` fill, gold border + glow on active, emoji icons (🌾 Grain, 🐂 Cattle, 🥛 Dairy), content-width (not full-span)
- Inner tabs: smaller pill-style buttons (`border-radius:5px`), gap spacing between items
- Mobile responsive: horizontal scroll with adjusted padding at 768px and 375px breakpoints

**Location bar restructured** — split into two rows for better mobile alignment:
- Top row: Location label + zip input + Go + "Use My Location" button + location name display
- Bottom row: Radius dropdown + Buyers dropdown
- Geo button: gold-tinted background with crosshair SVG icon + "Use My Location" label (was invisible `⌖` character)
- Location name: shown in bold gold after geolocation or zip lookup (calls `getCityName()` reverse geocode)
- `initLocation()` now displays city name on startup, or "SOUTHERN MN (DEFAULT)" if denied

**Yahoo Finance Globex fix** — electronic session prices were not updating after 7 PM CT:
- Added cache-buster (`&_t=` per-minute timestamp) to prevent CORS proxies from returning stale responses
- Changed API params from `interval=1d` to `interval=1m&includePrePost=true` to capture Globex/electronic session data
- Reduced cache TTL from 10 min to 5 min
- Adaptive refresh: 5 min polling when markets open/online, 15 min when closed (was fixed 15 min)
- Added console logging per ticker (`[yahoo] ZC=F price=456.25 ts=6:20 PM`) for diagnostics

---

## v1.164 (2026-03-31T06:00Z)

### Grain Charts, Location Filtering, Market Status, robots.txt Compliance

**Grain Charts tab** — new Charts tab under Grain with:
- CBOT futures historical chart (corn/soybeans toggle, 7D–5Y range)
- Local buyer basis chart with per-location lines and end-of-line labels
- Location checkbox dropdown (sorted by distance) with Select All / Clear All
- Syncs with buyer selections on Prices tab

**Location & Radius filtering** — replaced Area 1/2 region selector with:
- Zip code input + GPS button for precise location
- Radius dropdown (25/50/75/100/150 mi / All)
- Buyer checkbox dropdown with distance-sorted list
- Cash table filters to checked buyers within radius

**Market status indicator** — replaced misleading "Live data" label with:
- `Markets open` (green pulsing dot) — CBOT day session 8:30a–1:20p CT
- `Markets online` (gold pulsing dot) — Globex electronic session
- `Markets closed` (gray static dot) — daily break + weekends
- Shows actual Yahoo data timestamp ("last check 12:19 PM"), not wall clock

**No fallback basis** — all buyer `cornBasis`/`soyBasis` set to `null`. Prices only display when scraper provides real data. Removed fallback restore logic.

**Website URLs** — added `url` property to all 12 Region A elevators + CV Hope (Region B). Jennie-O updated to AgHost portal URL.

**robots.txt compliance** — new `scripts/robots-check.js` utility:
- Midnight workflow (`check-robots.yml`) fetches robots.txt for all sources daily
- Scrapers read `robots-log.json` (no network call) — skip if blocked
- Watchlist tracks sources that block us (DTN, CME, AgHost) for future unblock detection
- Al-Corn logo background fixed to white

**Watchdog workflow** — new `watchdog.yml` monitors all scheduled workflows:
- Triggers `workflow_dispatch` if a scraper missed its daily run
- Covers grain, barns, futures, and robots-check workflows
- Prevents silent data gaps from GitHub Actions cron skips

**Coordinates for all scraped locations** — added lat/lon for ~45 unmapped grain locations (CFS, NVC, AgP, CHS, Jennie-O) so all locations show distance in charts.

---

## v1.163 (2026-03-31T04:00Z)

### Live Cash Prices — Basis + CBOT Calculation
- **`js/markets.js` — `elevCashPrice()` + `buildCashTable()`** — cash prices now computed as `live CBOT futures + basis` instead of showing static scraped cash values. Prices update every 15 min with Yahoo CBOT feed. Basis remains static (scraped daily).
- **`js/markets.js` — scrape overlay** — when scraper returns empty array for a crop at a location, fallback basis is nulled out (no phantom prices). Pre-init clears fallback basis for all mapped elevators so stale estimates don't flash before scrape loads. Fallback restored on fetch failure.
- **`js/markets.js` — `cornBasisCalculated` / `soyBasisCalculated` flags** — set during overlay when `basisNote` starts with "calculated" (POET, Jennie-O). Distinguishes source-published basis from back-calculated basis.
- **`js/markets.js` — badge system rewrite** — three tiers: green `basis Mar 30 10:07 AM` (scraped from source), amber `basis calc. Mar 30 10:07 AM` (back-calculated from cash), gray `basis est. Mar 30 10:55 AM` (fallback estimate + CBOT time). Tooltips explain: "price updates live with CBOT".
- **`js/markets.js` — `updateGrainInsight()`** — insight strip now uses computed cash (CBOT + basis) for selected buyer and best-price calculations.
- **`js/markets.js` — null safety** — added guards for `cornBasis.toFixed()`, `onElevChange()`, and directory builder when basis is null.
- **`css/style.css`** — added `.barn-src-calc` badge class (amber/corn color) for calculated-basis indicators.

---

## v1.160–v1.162 (2026-03-30T23:00Z)

### Logo-First Grain Buyer Table Redesign
- 8 buyer logos, `BUYER_LOGOS` map, `buyerLogoHtml()` with initials fallback
- `buildCashTable()` rewrite: logo tile + location/buyer + corn/soy cash + basis sublabel + distance + links
- Sort bar: Distance (default), Corn ↓, Soy ↓. About page + How To updated.

---

## v1.151–v1.158 (2026-03-30T16:00Z)

### POET Grain Parser — Farmbucks Rewrite + Markets Wiring
- `scripts/grain/poet.js` rewritten for farmbucks.com. 3 MN locations (Bingham Lake, Lake Crystal, Preston). Corn only.
- Calculated basis for cash-only sources: scraper fetches CBOT at start, computes `basis = cash - CBOT` for POET/Jennie-O.
- History limits removed (grain was 30 days, now unlimited). 5 MB file size warnings added.

---

## v1.150 (2026-03-27T22:00Z)

### #27Herd Teaser — Herd Tab Overhaul
- Full interactive teaser: pen view preview, incoming card, recent buys/sales feeds, early access signup
- Mobile responsive with 500px breakpoint

---

## v1.143–v1.148 (2026-03-27T17:00Z)

### Service Worker + CI Fixes
- SW: Yahoo/CORS proxy domains added to network-only list (were serving stale cached data on mobile PWA)
- `push-main.ps1`: added `git reset --hard origin/main` before merge to handle scraper commits on main
- npm caching: `package.json` + `package-lock.json` added, workflows switched to `npm ci` with `cache: 'npm'`

---

## v1.128–v1.140 (2026-03-27)

### Infrastructure & Parsers
- **Scraper workflow migration** — all 3 workflows run on `main` and commit directly. `push-main.ps1` auto-syncs `data/prices/`. New `test-scrapers.yml` dry-run. Staleness alerts. Upgraded to `actions/checkout@v4`.
- **Sleepy Eye parser fixes** — feeder entry selection picks most brackets, split repSales by category, CBOT timestamp docs.
- **Blue Earth Stockyard** — directory-only entry. About page status colors fixed.

---

## v1.116–v1.126 (2026-03-25 → 2026-03-26)

### Cattle Charts Overhaul (v1.116)
- Real 5-year CME historical data via server-side scraper (`scrape-futures-history.js`), replacing random-walk charts
- Futures/Auction toggle: 4 CME charts + seasonal panel vs multi-barn overlay with insights + sale calendar
- Expanded range buttons (7D–5Y), cattle type discounts applied to charts, real seasonal pattern from 5yr monthly data

### Grain Parsers (v1.117–v1.125)
- **Al-Corn** — CIH widget parser, corn only, Claremont MN, 13 delivery months with basis/futures stored
- **POET** — built for Gradable, blocked by WAF, shelved (later rewritten for farmbucks.com in v1.151)
- **Est. badges** — non-scraped buyers show muted `est.` tag, basis hidden for estimated rows

### Frontend Polish (v1.126)
- About page brand-voice rewrite, page loader overhaul (360px logo, 7s animation, rotating taglines)

### Yahoo Finance Migration (v1.115)
- Replaced Stooq with Yahoo v8 chart API. Cached batch fetch, 200ms stagger, exchange timestamps. 8 tickers.

---

## v1.32–v1.114 (2026-03-22 → 2026-03-25)

### Barn Parsers
- **Central** (v1.32–v1.37) — OCR pipeline: Tesseract.js + sharp, adaptive crop, HOCR column detection, rep sales
- **Rock Creek** (v1.66–v1.82) — PDF parser: `pdf-parse@1.1.1`, two-column regex, three-phase date filter, batch processing
- **Lanesboro** (v1.106–v1.114) — HTML parser: Webflow `<h5>` sequences, Wed slaughter + Fri feeder, Top Producers rep sales

### Grain Parsers
- **CFS** — DTN Cashbid widget, 13 locations
- **MVG** — dynamic widget, Barchart fallback
- **AGP** — dynamic widget, 13 locations
- **CHS** — discovery parser, stacked locations
- **Jennie-O** (v1.83) — rewritten from aghostportal to farmbucks.com, cash-only, 4 MN locations
- **New Vision** (v1.87–v1.101) — AgriCharts JSON API, 22 locations, basis+basisMonth stored

### PWA Frontend (v1.38–v1.101)
- Full markets module: grain/cattle/dairy prices, margin calculators, directories, weather
- Dynamic CBOT labels, scraped CBOT fallback, green/gray/contract badges, canvas charts
- Geolocation sorting, mobile responsive, service worker

### CI/CD (v1.54–v1.65)
- Scraper workflows (barns + grain), PS1 push scripts, npm caching
