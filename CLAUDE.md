# grow27 project context — branching, versioning & data pipeline

Repo: `C:\Users\MRJ\source\repos\grow27` · GitHub Pages PWA at `https://michael-ticmn.github.io/grow27/`

---

## Branch rules
- `UserUpdates` — all active work. CSS, JS, HTML edits, workflow/script fixes, data files. Default working branch.
- `dev` — major new features or structural changes only
- `main` — production. Never edit directly. Code promoted via PS1 script from UserUpdates. Data files (`data/prices/`) are pushed to main automatically by scraper workflows.

---

## Versioning
Current version in `version.json` — format `major.minor` (e.g. `1.15`). Same version written into `sw.js` as the service worker cache name `grow27-v1.15`. Never manually edit either file — the PS1 scripts handle both atomically.

| Script | Branch | Bump | Use for |
|---|---|---|---|
| `push-userupdates.ps1` | UserUpdates | minor (1.15 → 1.16) | CSS/JS fixes, data changes, workflow updates |
| `push-dev.ps1` | dev → main | major (1.x → 2.0) | New features, structural changes |
| `push-main.ps1` | UserUpdates → main | none | Promoting UserUpdates to production |

**Typical workflow:**
```powershell
# Set MSG variable, then run the script — never edit PS1 files for messages
$MSG = "fix: describe the change here"
.\push-userupdates.ps1

# When ready to go to production:
.\push-main.ps1
```

**When Claude executes PS1 scripts** — use `powershell.exe -Command` from bash. Stage files with `git add` first, then run:
```bash
# push-userupdates.ps1 with commit message:
powershell.exe -Command '$MSG = "fix: describe the change"; & "./push-userupdates.ps1"'

# push-main.ps1 (no message needed):
powershell.exe -File "./push-main.ps1"
```
Never tell the user to edit the PS1 file. Claude must never modify `version.json` or the `sw.js` cache string — the PS1 scripts handle both.

---

## File change rules — LOCAL FIRST workflow

Claude edits files directly in the local repo. Michael validates locally before anything is pushed.

**Mandatory flow for every change:**

1. **Edit** — Claude saves file changes locally (no commit, no push)
2. **Verify** — Michael refreshes local Live Server (127.0.0.1:5500) and confirms the change looks correct. If service worker caches stale assets, use incognito or clear cache.
3. **Push to UserUpdates** — Only after Michael approves, Claude provides git commands:
   - Always lead with `git checkout UserUpdates`
   - Use specific file paths in `git add`, never `git add .`
4. **Workflow** — If the change involves `scripts/` or `.github/workflows/`, trigger the workflow and verify logs
5. **Push to main** — Michael runs `.\push-main.ps1` to promote to production

**Claude must NEVER provide commit/push commands before Michael has verified locally.**

**Commit message prefixes:** `fix:` `feat:` `ci:` `data:` `style:` `infra:`

---

## Data pipeline
- `data/barns-config.json` — barn registry. Add a barn here only; no code changes needed.
- `data/prices/<id>.json` — per-barn history, max 14 entries / 14 days
- `data/prices/index.json` — latest snapshot, one entry per barn (what the PWA reads)
- `scripts/scrape-barns.js` — **orchestrator**. Loops barns, fetches pages via Puppeteer, delegates parsing to barn-specific modules, writes output. Exports shared helpers (`normalizePrice`, `extractLinePrice`, regex constants) for barn parsers.
- `scripts/barns/<id>.js` — barn-specific parser module. Exports `parse({ id, browser, html, $ })` returning `{ slaughter, feeder, feederWeights, repSales, ... }`. Currently: `central.js` (OCR + rep sales), `lanesboro.js` (plain HTML), `rockcreek.js` (PDF), `sleepyeye.js` (Google Sheets CSV).
- `scripts/barns/_default.js` — fallback parser for barns without custom logic (returns `pending`).
- `.github/workflows/scrape-barns.yml` — runs on `main`, triggers daily 4am CT + 7am CT backup (`0 10,12 * * *`) and via `workflow_dispatch`. Commits price files directly to `main`.
- `.github/workflows/test-scrapers.yml` — runs on `UserUpdates` push when `scripts/`, config, or workflow files change. Dry-run validation of all three scrapers (no commit). Also available via `workflow_dispatch`.

**Adding a new barn parser:** Create `scripts/barns/<id>.js` matching the id in `barns-config.json`. Export `parse({ id, browser, html, $ })`. The orchestrator picks it up automatically — no changes to `scrape-barns.js` needed. **Also update the Data Sources section in the About page** (`index.html` → `#mod-about` → `#about-sources`).

**Multiple sale days per barn:** Use a `reports` array in `barns-config.json` instead of a single `reportUrl`. Each entry has `{ "day": "Monday", "url": "..." }`. The orchestrator loops all reports, deduplicates history by `date + saleDay`, and the index includes a `saleDays` array with per-day data. Currently: Central has Monday (cattle) and Wednesday (cattle + hogs). Lanesboro has Wednesday (slaughter) and Friday (feeder).

**Hog data:** Captured by `central.js` from the Wednesday cattle+hogs report and stored as `hogs: { marketHogs, sows, boars }` in history/index. Not displayed in the PWA yet — stored for future use.

**Scrape sources:**

| `source` value | Meaning |
|---|---|
| `scraped` | Live Puppeteer pull from barn's report page |
| `fetch_failed` | Puppeteer succeeded but zero prices parsed, or network error |
| `pending` | No `reportUrl` configured for this barn |
| `directory` | Directory-only entry — no parser, no scraping. Shows in barn directory but not price table |

**Staleness alerts:** `scripts/check-staleness.js` runs at the end of each scraper workflow. If any active source's `lastSuccess` exceeds its threshold (barns: 7 days, grain/futures: 3 days), the workflow exits 1 and GitHub sends a failure notification. Skips `pending` and `directory` entries.

**Discount schedule applied to beef baseline:**
- Crossbred slaughter: −$9.50/cwt · feeder: −$3.80/cwt
- Holstein slaughter: −$30.00/cwt · feeder: −$12.00/cwt

---

## Grain data pipeline
- `data/grain-config.json` — grain source registry. Each entry has `id`, `name`, `url`, `locations[]`, `commodities[]`.
- `data/prices/grain/<id>.json` — per-source history, max 14 entries / 14 days
- `data/prices/grain/index.json` — latest snapshot, one entry per source (what the PWA will read)
- `scripts/scrape-grain.js` — **orchestrator**. Loops grain sources, launches Puppeteer, delegates parsing to source-specific modules, writes output.
- `scripts/grain/<id>.js` — source-specific parser module. Exports `parse({ id, config, browser })` returning `{ locations: { [slug]: { name, corn: [...], beans: [...] } }, source, error }`.
- `scripts/grain/_default.js` — fallback parser (returns `pending`).
- `.github/workflows/scrape-grain.yml` — runs on `main`, triggers Mon–Fri 4am CT + 7am CT backup (`0 10,12 * * 1-5`) and via `workflow_dispatch`. Commits price files directly to `main`.

**Currently configured:** CFS (Central Farm Service) — 13 locations across southern MN. Uses DTN Cashbid widget; parser selects each location from dropdown and reads `<table id="dtn-bids">`.

**Adding a new grain source:** Create `scripts/grain/<id>.js` matching the id in `grain-config.json`. Export `parse({ id, config, browser })`. The orchestrator picks it up automatically. **Also update the Data Sources section in the About page** (`index.html` → `#mod-about` → `#about-sources`).

**Grain bid data shape per location:**
```json
{
  "name": "St. James",
  "corn": [
    { "delivery": "Mar26", "cash": 4.155, "futuresMonth": "@C6K", "basis": -0.5, "change": "-4'2", "cbot": "465'4s" }
  ],
  "beans": [ ... ]
}
```

---

## Billing & API Usage
Never use API credits or pay-as-you-go billing under any circumstances.
All usage must stay within the included Max plan allocation only.
If a usage limit is reached, stop and notify Michael — do not offer or switch to API credits.
Do not set, use, or reference any ANTHROPIC_API_KEY environment variable.

---

## Browser Usage
Never open Chrome. If a browser is required, use Microsoft Edge only.
Do not access saved credentials, autofill data, or browser storage from any browser.

---

## Sync Files
STRATEGY.md, HANDOFF_QUEUE.md, BRAND.md, BUILD_LOG.md, CURRENT_STATE.md live
in the repo root. Read them at the start of every session. Update the relevant
file before ending any session. Commit them with the same push as code changes.

---

## Never touch directly
Never edit files directly on main. All changes to index.html, js/, and css/ must be made on UserUpdates and promoted to main via push-main.ps1. Exception: scraper workflows automatically push `data/prices/` to main.
