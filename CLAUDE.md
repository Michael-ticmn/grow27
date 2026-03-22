# grow27 project context — branching, versioning & data pipeline

Repo: `C:\Users\MRJ\source\repos\grow27` · GitHub Pages PWA at `https://michael-ticmn.github.io/grow27/`

---

## Branch rules
- `UserUpdates` — all active work. CSS, JS, HTML edits, workflow/script fixes, data files. Default working branch.
- `dev` — major new features or structural changes only
- `main` — production. Never edit directly. Promoted via PS1 script from UserUpdates.

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

**When Claude provides PS1 commands** — always pass `$MSG` as a variable assignment on the line before the script call. Never tell the user to edit the PS1 file.

**When Claude provides git commands** — provide raw `git add / commit / push` steps only, no version bumping. Michael runs the PS1 scripts manually. Claude must never modify `version.json` or the `sw.js` cache string.

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
- `scripts/barns/<id>.js` — barn-specific parser module. Exports `parse({ id, browser, html, $ })` returning `{ slaughter, feeder, feederWeights, repSales, ... }`. Currently: `central.js` (OCR + rep sales).
- `scripts/barns/_default.js` — fallback parser for barns without custom logic (returns `pending`).
- `.github/workflows/scrape-barns.yml` — runs on `UserUpdates`, triggers daily 7am CT (`0 12 * * *`) and via `workflow_dispatch`. Commits price files back to `UserUpdates`.

**Adding a new barn parser:** Create `scripts/barns/<id>.js` matching the id in `barns-config.json`. Export `parse({ id, browser, html, $ })`. The orchestrator picks it up automatically — no changes to `scrape-barns.js` needed.

**Scrape sources:**

| `source` value | Meaning |
|---|---|
| `scraped` | Live Puppeteer pull from barn's report page |
| `fetch_failed` | Puppeteer succeeded but zero prices parsed, or network error |
| `pending` | No `reportUrl` configured for this barn |

**Discount schedule applied to beef baseline:**
- Crossbred slaughter: −$9.50/cwt · feeder: −$3.80/cwt
- Holstein slaughter: −$30.00/cwt · feeder: −$12.00/cwt

---

## Never touch directly
Never edit files directly on main. All changes to index.html, js/, and css/ must be made on UserUpdates and promoted to main via push-main.ps1
