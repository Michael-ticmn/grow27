# Handoff Queue — grow27

Decisions and open items for the next session to pick up.

---

## Completed This Session (v1.175)

- [x] Staleness override for jennieo + poet set to 14d (v1.175). farmbucks.com stopped serving both bid pages ~2026-06-06 (now "No results", zero tables, server-rendered, confirmed via WebFetch from a non-Actions IP — upstream outage, not a code bug). Stops the daily grain-workflow false-alarm failures. **See pending decision below — re-check ~2026-06-19.**

## Completed Prior Session (v1.173–v1.174)

- [x] Staleness check per-barn threshold override — rockcreek set to 14d, default stays 7d barns / 3d grain (v1.173). Resolved false-alarm workflow failures from Rock Creek's irregular publishing cadence.
- [x] Fixed `push-main.ps1` data-sync detection + checkout guard (v1.174). The line-9 `$hasChanges` bug skipped the data-sync commit and a failed checkout fell through to `git reset --hard`, clobbering the local branch ref during promotion.

## Completed Earlier (v1.169)

- [x] Market status fix — correct state shown when Yahoo fetch fails on mobile (v1.168)
- [x] Watchdog workflow fix — added `permissions: actions: write` for workflow_dispatch (v1.169)

## Pending Handoffs

### [ ] [FROM: Code] CFS + AGP grain bids dark since 2026-10-02 — TEMP 7d OVERRIDE, alerts resume 2026-10-10Z
- **Symptom:** every grain run since 2026-10-05 captured 0 locations for `cfs` and `agp`; last good scrape 2026-10-02T17:36Z. The other 7 grain sources scrape normally.
- **Root cause is upstream (verified 2026-10-07T01:30Z from a local machine, not an Actions IP):** AGP's DTN API `api.dtn.com/markets/sites/e0172401/cash-bids` returns 200 with `[]` (widget spins forever). CFS's proxy `POST cfscoop.com/DtnCashbidWidget/GetFullDetails` returns an empty string for every location (dropdown still lists all 13). Both are DTN-backed. Not a parser bug.
- **Temp fix:** `staleDays: 7` on `cfs` and `agp` in `data/grain-config.json`. The check fails when age > limit, so failures resume on the first run of 2026-10-10Z if still dark (about one week of lost data).
- **Decision when the alert re-fires:** (a) ask CFS / Ag Partners whether their DTN bid feed is down or moved, (b) mark them `directory`, or (c) remove the override once data returns. Either way, remove the override after resolution.

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

### 0. farmbucks outage — Jennie-O & POET — RE-CHECK ~2026-06-19
- **Status:** Both farmbucks.com bid pages went dark ~2026-06-06 ("No results — Please try again later", zero tables). Suppressed with `staleDays: 14` in `grain-config.json` (v1.175) to stop daily workflow failures. Parsers + config left intact so they resume automatically if data returns.
- **Affected:** Jennie-O (Atwater, Dawson, Faribault, Perham); POET MN plants (Bingham Lake, Lake Crystal, Preston). `newvision`'s `poet-ashton` is Ashton **IA** — does NOT cover the MN POET plants.
- **Decision needed if still dark at 14d (alert re-fires):** (a) mark both `directory`/`pending`, (b) remove the sources, or (c) find an alternate source (DTN, individual elevator pages, or a New Vision slug for the MN POET plants).
- **Update 2026-10-05T19:00Z:** origin/main `data/prices/grain/index.json` shows `jennieo` (4 locations) and `poet` (3 locations) with `lastSuccess` 2026-10-05, so farmbucks is serving bids again. Remaining decision: remove the temporary `staleDays: 14` override in `data/grain-config.json` (and the matching note in CURRENT_STATE.md), or keep it.

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
