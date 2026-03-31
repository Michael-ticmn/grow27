# Handoff Queue — grow27

Decisions and open items for the next session to pick up.

---

## Completed This Session (v1.166)

- [x] Location name layout fix — no longer obscured by radius row on mobile
- [x] Buyers dropdown mobile overflow fix — anchors right, capped to viewport width
- [x] Market status logic rewrite — Intl.DateTimeFormat, all 5 CBOT session windows modeled correctly
- [x] CLAUDE.md — added Browser Usage + Billing & API Usage sections
- [x] Location name fix — `userLocName` persists city name across filter updates, displays in status bar

## Pending Handoffs

### [ ] [FROM: Code] Basis + live CBOT pricing architecture — QUEUED 2026-03-25
- **Task:** Refactor frontend to compute cash = CBOT futures + scraped basis (instead of using source's snapshot cash price)
- **Why:** Scraped cash prices drift between scrapes as futures tick. Basis is stable (~1x/day change). Computing cash from live CBOT + basis gives real-time accuracy.
- **Approach:** Scraper stores basis per elevator per delivery month. Frontend reads live futures. `cash = futures[basisMonth] + basis`.

### [ ] [FROM: Code] Price history by location — QUEUED 2026-03-30
- **Task:** Add history-by-location views to the PWA so users can see price trends over time per elevator/barn
- **Context:** History limits removed from both scrapers. Data accumulating in `data/prices/grain/<id>.json` and `data/prices/<id>.json`. File sizes monitored at 5 MB threshold.
- **Decision needed:** UI design — chart per location? table view? Which locations/sources first?

---

## Pending Decisions

### 1. Hog data display — DEFERRED
- Central parser captures hog data (market hogs, sows, boars) from Wednesday reports. Stored but not displayed. Future build when needed.

### 2. Remaining barn parsers
- Pipestone still returns `pending`. Does Pipestone publish online reports?

### 3. Herd / Fields / Finance modules
- Herd: interactive teaser with pen view preview, recent buys/sales, early access signup. Static demo data only.
- Fields and Finance: placeholder stubs. Decision needed on content and priority.

### 4. ADM Mankato — no dedicated parser
- New Vision covers ADM Mankato as secondary source. No dedicated ADM scraper. Flagged for future.

### 5. Barn scraper runtime — MONITORING
- Runs ~5.5 min total. Sequential Puppeteer + OCR is the bottleneck. Parallelizing could bring to ~1.5 min. Monitoring baseline.

---

## Known Issues

### Commit messages v1.54–v1.64
- Placeholder messages from PS1 bug. Fixed in v1.65, historical messages lost.

---

## Completed (condensed)

- Rock Creek barn parser — PDF-based, batch YTD — v1.66–v1.82 (2026-03-24)
- Jennie-O parser rewrite — farmbucks.com, cash-only — v1.83–v1.85 (2026-03-24)
- New Vision parser — AgriCharts JSON, 22 locations — v1.87–v1.101 (2026-03-25)
- Lanesboro parser — HTML, Wed slaughter + Fri feeder — v1.106–v1.114 (2026-03-25)
- Yahoo Finance migration — replaced Stooq, cached batch fetch — v1.115 (2026-03-25)
- Cattle charts overhaul — 5yr history, Futures/Auction toggle, seasonal — v1.116 (2026-03-25)
- Al-Corn grain parser — CIH widget, corn only — v1.117–v1.121 (2026-03-26)
- POET parser — farmbucks.com, 3 MN locations — v1.151–v1.154 (2026-03-30)
- Calculated basis for cash-only sources — v1.156–v1.157 (2026-03-30)
- Logo-first grain buyer table — logos, sort bar, links — v1.160 (2026-03-30)
- Grain Charts tab — CBOT futures + buyer basis charts — v1.164 (2026-03-31)
- About page rewrite, page loader, est. badges, CBOT labels — v1.125–v1.126 (2026-03-26)
- CBOT futures scraper — resolved via Yahoo client-side fetch (2026-03-25)
- UI polish — button tabs, location bar, Yahoo Globex fix — v1.165 (2026-03-31)
