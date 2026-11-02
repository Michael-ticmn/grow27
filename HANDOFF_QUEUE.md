# Handoff Queue — grow27

Decisions and open items for the next session to pick up.

---

## Completed This Session (v1.177)

- [x] Jennie-O parser fixed (v1.177). farmbucks shortened location names ~2026-10-15 ("Atwater Feed Mill" → "Atwater") and the parser matched 0 of 27 rows, so the 2026-11-02 grain runs failed staleness (17d over 14d). Also fixed an older rowspan bug that kept only 1 bid per location. Live-page test: 27/27 rows, 3 locations. Faribault is no longer on the page; see pending decision 0.
- [x] Grain `staleDays` overrides removed for cfs, agp, jennieo, poet (v1.177). DTN feeds for cfs + agp are back (13 locations each on 2026-11-02); the farmbucks outage behind the 14d override lasted only 2026-06-08 to 2026-06-11. All grain sources back on the 3d default. Closes the CFS + AGP handoff and the old farmbucks-outage decision.

## Completed Earlier (v1.175)

- [x] Staleness override for jennieo + poet set to 14d (v1.175). farmbucks.com stopped serving both bid pages ~2026-06-06 (now "No results", zero tables, server-rendered, confirmed via WebFetch from a non-Actions IP — upstream outage, not a code bug). Stops the daily grain-workflow false-alarm failures. **See pending decision below — re-check ~2026-06-19.**

## Completed Prior Session (v1.173–v1.174)

- [x] Staleness check per-barn threshold override — rockcreek set to 14d, default stays 7d barns / 3d grain (v1.173). Resolved false-alarm workflow failures from Rock Creek's irregular publishing cadence.
- [x] Fixed `push-main.ps1` data-sync detection + checkout guard (v1.174). The line-9 `$hasChanges` bug skipped the data-sync commit and a failed checkout fell through to `git reset --hard`, clobbering the local branch ref during promotion.

## Completed Earlier (v1.169)

- [x] Market status fix — correct state shown when Yahoo fetch fails on mobile (v1.168)
- [x] Watchdog workflow fix — added `permissions: actions: write` for workflow_dispatch (v1.169)

## Pending Handoffs

### [ ] [FROM: Code] UX review: end to end (logical flow, intuitive use, visual appeal) — FIND DONE 2026-10-06T01:03Z, VERIFY NEXT
- **Ask (Michael, 2026-10-05):** review the website end to end for logical flow, intuitive use and visual appeal; identify and classify suggested updates.
- **Everything lives in** `.claude/ux-review-2026-10-05/` (untracked, local only). Start with `RESUME.md` there.
- **Evidence:** live site v1.175 captured 2026-10-05T21:12Z in headless Edge (throwaway profile): 201 phone/desktop screens across all 26 views, visible text per view, automated audits (text under 11px, contrast, tap targets, console and network errors, load time).
- **Find phase (complete):** 9 reviewers (5 areas + 4 lenses) produced 169 raw findings (P1 36, P2 103, P3 30), none verified yet. Expect heavy duplication across the lens reviewers. Saved as JSON in `results/reviewers-completed-batch1.json` and `-batch2.json`, with readable `findings-batch*-UNVERIFIED.md` indexes. Batch 2 first hit the plan session limit and was re-run after the 7:30 PM CT reset.
- **Related review:** a concurrent session's PWA review (code and pipeline focus, items claimed verified) is copied to `results/prior-pwa-review-2026-10-05.md`. Its top item: `calcSoy()` throws on every load (`js/app.js:159`), so price auto-refresh, weather refresh and service worker registration never run. Re-verified here: `js/markets.js:1301` writes `sv-sale`, which no markup or code creates (the field renderer makes `s-yield` from `markets.js:148` and uses a `cv-` prefix), and the live capture logged that exact null `textContent` error on every load. The verify step merges it with this review's findings.
- **Next:** run `workflow/verify-findings.js` (merge duplicates including the prior review, adversarially verify each finding, second-check every P1), then write the final classified list (P1/P2/P3 × flow/use/visual × type × effort × UserUpdates/dev lane) back into this file.
- **Usage:** the find phase was heavy, about 4.8M subagent tokens in total: 2.6M in a first run that hit the plan limit while a concurrent desktop + PWA review session was also running, then 2.2M for the re-run. Start the verify run at the beginning of a fresh plan window, with no other heavy session running.

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

### 0. Jennie-O Faribault no longer on farmbucks (since ~2026-10-15Z)
- **Status:** farmbucks' Jennie-O MN page now lists only Atwater, Dawson, Perham. `Faribault Mill` stays in `grain-config.json` so it resumes automatically if it returns; it does not affect staleness (that is per source).
- **PWA effect:** the curated `jennyo` buyer (Faribault, `js/markets.js` GRAIN_SCRAPE_MAP) maps to `faribault-mill`, so after v1.177's first good run that card shows its static "call for daily bids" state instead of 2026-10-16 prices.
- **Decision:** (a) leave as is, (b) remove Faribault from config, or (c) find another Faribault source (the AgHost portal is robots-blocked per `scripts/robots-check.js`).

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

### MVG and Sleepy Eye missing from production indexes (found 2026-10-05T21:12Z)
- origin/main `data/prices/grain/index.json` has no `mvg` entry and `data/prices/index.json` has no `sleepyeye` entry (checked at the 2026-10-05T19:00Z/19:10Z data commits). Both are configured in `data/*-config.json`, and the About page lists both as Active (MVG "3 locations").
- Sleepy Eye has had no new data for six months: origin/main `data/prices/sleepyeye.json` was last written 2026-03-30T12:14Z and its newest sale is 2026-03-25. The cattle trend modal still opens for Sleepy Eye and plots the Mar 11 and Mar 25 sales as an "Increasing" trend (screenshot `cattle-trend-modal-01.png` in the UX review evidence).
- **Why no alert fired:** `scripts/check-staleness.js:61` loops over the entries present in index.json; the config file is read only for `staleDays` overrides (lines 51-59). A configured source that disappears from the index entirely is never checked. Suggested fix: also iterate the config ids and flag any active (non-`pending`, non-`directory`) source missing from the index.
- **Root cause:** robots.txt. origin/main `data/robots-log.json` marks both `mvg` and `sleepyeye` `"allowed": false, "reason": "disallowed by robots.txt"` (checked 2026-10-05T14:14Z), so the scrapers correctly skip them, and they then vanish silently. The concurrent PWA review (`C:\tmp\g27t\reviews\pwa-review-2026-10-05.md`, item 5) reports MVG `Disallow: /markets/` and docs.google.com `Disallow: /` since 2026-03-31 (that date is not re-verified here).
- **Decision needed:** mark both `directory` (or remove them) and update the About page "Data Sources" table, since grow27 promises to respect robots.txt.

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
- Mobile fixes, market status rewrite, location name persist — v1.166 (2026-03-31)
- Delivery month filter, OSM discovery, Request Prices — v1.167 (2026-03-31)
- Market status Yahoo fetch fix — v1.168 (2026-04-02)
