# Handoff Queue — grow27

Decisions and open items for the next Chat session to pick up.

---

## Pending Handoffs

### [x] [FROM: Chat → Code] Rock Creek barn parser — COMPLETED 2026-03-24
- **Date queued:** 2026-03-24
- **Task:** Build `scripts/barns/rockcreek.js` and update `data/barns-config.json`
- **Full prompt:** See below — copy/paste directly into Claude Code

```
We're adding a barn scraper parser for Rock Creek Livestock Market to the grow27 project.

Read these files first to understand the existing architecture:
- CLAUDE.md — branching rules, data pipeline conventions
- scripts/scrape-barns.js — the orchestrator (understand how parsers are loaded)
- scripts/barns/central.js — the reference parser implementation
- data/barns-config.json — check how Central is configured

What we're building:
Create scripts/barns/rockcreek.js — a parser for Rock Creek Livestock Market.

How Rock Creek publishes reports:
- They list reports on their website (irregular dates, not weekly)
- PDF URL pattern: https://rockcreeklivestockmarket.com/wp-content/uploads/YYYY/MM/YYYY-MM-DD-mr.pdf
- Strategy: scrape the index page for links matching that pattern, get the list of available PDFs sorted newest-first

Date filter logic (three phases — controlled by a DEV_MODE flag and last-captured date):

Phase 1 — DEV_MODE = true
  - Download only the 2 most recent PDFs regardless of date
  - For validating the parser works before touching real data

Phase 2 — DEV_MODE = false, no prior history
  - Download all PDFs from January 1 of the current year through today (year-to-date)
  - This is the catch-up run

Phase 3 — DEV_MODE = false, history exists
  - Read data/prices/rockcreek.json (or the index) to find the most recent date already captured
  - Download only PDFs newer than that date
  - This is the ongoing incremental run

Parser must export: parse({ id, browser, html, $ })
Return shape should match central.js as closely as possible: { slaughter, feeder, feederWeights, repSales, source }

Also update data/barns-config.json to add Rock Creek with its reportUrl.

Do not touch version.json, sw.js, or push anything. Edit only:
- scripts/barns/rockcreek.js (new file)
- data/barns-config.json (add entry)

Show me two things before writing the full parser:
1. The barns-config.json entry
2. The URL discovery + date filter logic — print which PDFs would be selected in each of the three phases given today's date
```

---

### [x] [FROM: Chat → Code] New Vision Cooperative grain parser — COMPLETED 2026-03-25
- **Date queued:** 2026-03-24
- **Task:** Build `scripts/grain/newvision.js` and update `data/grain-config.json`
- **Full prompt:** See below — copy/paste directly into Claude Code

```
We're adding a grain scraper parser for New Vision Cooperative to the grow27 project.

Read these files first to understand the existing architecture:
- CLAUDE.md — branching rules, data pipeline conventions
- scripts/scrape-grain.js — the orchestrator
- scripts/grain/cfs.js — reference parser (per-location, cheerio-based)
- data/grain-config.json — check CHS entry to confirm its exact location slugs/names
- data/prices/grain/index.json — see existing data shape

---

WHAT WE'RE BUILDING:
Create scripts/grain/newvision.js — a parser for New Vision Cooperative grain prices.

URL: https://newvision.coop/current-grain-prices/?format=grid&groupby=location&setLocation=&commodity=

---

PAGE STRUCTURE (groupby=location view):
The page renders per-location table blocks. Each block has:
- A location header (e.g. "MOUNTAIN LAKE")
- A table with rows: Commodity (Corn / Soybeans) and columns for delivery months (Mar 26, Apr 26, May 26, etc.)
- Cash prices in green, some cells empty (no bid for that month)
- Some locations have corn only, some soybeans only, some both

The page requires JavaScript to render — use Puppeteer, wait for table content to appear before parsing.
Respect the crawl-delay: wait at least 10 seconds after page load before scraping (robots.txt specifies Crawl-delay: 10).

---

FULL LOCATION LIST (22 locations):
ADM Mankato, Adrian, AGP Sheldon, Beaver Creek, Brewster, CHS Fairmont, CHS Mankato,
Dundee, Ellsworth, Heron Lake, Hills Terminal, Jeffers, Magnolia, Mankato, Miloma,
MNSP Brewster, Mountain Lake, POET Ashton, Reading, Wilmont, Windom, Worthington

Scrape ALL 22 locations. No filtering at scrape time.

---

OVERLAP FLAGS (read grain-config.json to confirm CHS slugs, then note these in grain-config.json):
- CHS Fairmont → already covered by CHS parser (chs.js). New Vision is secondary.
- CHS Mankato → already covered by CHS parser (chs.js). New Vision is secondary.
- AGP Sheldon → already covered by AGP parser (agp.js). New Vision is secondary.
- ADM Mankato → NOT currently scraped. Flag in grain-config.json as: "note": "ADM Mankato gap — no dedicated ADM parser yet. New Vision is only source."
- POET Ashton, MNSP Brewster — scrape and store, no known overlap.

---

DATA SHAPE — return per location:
{
  "name": "Mountain Lake",
  "corn": [
    { "delivery": "Mar26", "cash": 4.105 },
    { "delivery": "Apr26", "cash": 4.125 }
  ],
  "beans": [
    { "delivery": "Mar26", "cash": 10.60 }
  ]
}

No basis, no futuresMonth, no change — this source is cash-only per delivery month.
Empty cells = omit that delivery month entirely (don't store null entries).
If a location has no corn bids, corn array is empty []. Same for beans.

---

PARSER EXPORT:
Export parse({ id, config, browser }) — same signature as cfs.js.
Return: { locations: { [slug]: { name, corn, beans } }, source, error }

Slugs should be lowercase-hyphenated: "mountain-lake", "chs-fairmont", "adm-mankato", etc.

---

grain-config.json ENTRY to add:
{
  "id": "newvision",
  "name": "New Vision Cooperative",
  "url": "https://newvision.coop/current-grain-prices/?format=grid&groupby=location&setLocation=&commodity=",
  "locations": [
    { "slug": "adm-mankato", "name": "ADM Mankato", "note": "ADM gap — no dedicated ADM parser. New Vision is only source." },
    { "slug": "adrian", "name": "Adrian" },
    { "slug": "agp-sheldon", "name": "AGP Sheldon", "overlap": "agp" },
    { "slug": "beaver-creek", "name": "Beaver Creek" },
    { "slug": "brewster", "name": "Brewster" },
    { "slug": "chs-fairmont", "name": "CHS Fairmont", "overlap": "chs" },
    { "slug": "chs-mankato", "name": "CHS Mankato", "overlap": "chs" },
    { "slug": "dundee", "name": "Dundee" },
    { "slug": "ellsworth", "name": "Ellsworth" },
    { "slug": "heron-lake", "name": "Heron Lake" },
    { "slug": "hills-terminal", "name": "Hills Terminal" },
    { "slug": "jeffers", "name": "Jeffers" },
    { "slug": "magnolia", "name": "Magnolia" },
    { "slug": "mankato", "name": "Mankato" },
    { "slug": "miloma", "name": "Miloma" },
    { "slug": "mnsp-brewster", "name": "MNSP Brewster" },
    { "slug": "mountain-lake", "name": "Mountain Lake" },
    { "slug": "poet-ashton", "name": "POET Ashton" },
    { "slug": "reading", "name": "Reading" },
    { "slug": "wilmont", "name": "Wilmont" },
    { "slug": "windom", "name": "Windom" },
    { "slug": "worthington", "name": "Worthington" }
  ],
  "commodities": ["corn", "beans"]
}

---

scrape-grain.yml — add newvision to the workflow if it's not picked up automatically.
Check how other sources are triggered and match the pattern.

---

DO NOT TOUCH:
- version.json
- sw.js
- push anything to git

Edit only:
- scripts/grain/newvision.js (new file)
- data/grain-config.json (add entry)
- .github/workflows/scrape-grain.yml (only if newvision needs explicit registration)

---

SHOW ME BEFORE WRITING THE FULL PARSER:
1. The parsed location block structure you expect to find in the HTML (one example location)
2. How you'll handle locations that have corn only vs beans only vs both
3. Confirm you read grain-config.json and tell me the exact CHS location slugs/names already stored there
```

---

### [x] [FROM: Code] Dedicated CBOT futures scraper — RESOLVED 2026-03-25
- **Date queued:** 2026-03-25
- **Resolution:** Replaced Stooq with Yahoo Finance client-side fetch. `prefetchYahoo()` fetches all 8 tickers at startup, cached 10 min. No server-side scraper needed — Yahoo v8 chart API is reliable from the browser with CORS proxy fallback.
- **Symbols:** `ZC=F`, `ZCZ26.CBT`, `ZS=F`, `ZSX26.CBT`, `LE=F`, `GF=F`, `DC=F`, `ZM=F`

---

### [ ] [FROM: Code] Basis + live CBOT pricing architecture — QUEUED 2026-03-25
- **Date queued:** 2026-03-25
- **Task:** Refactor frontend to compute cash = CBOT futures + scraped basis (instead of using source's snapshot cash price)
- **Why:** Scraped cash prices drift between scrapes as futures tick. Basis is stable (~1x/day change). Computing cash from live CBOT + basis gives real-time accuracy.
- **Prerequisites:** Dedicated CBOT scraper (above), `basisMonth` already stored in New Vision data
- **Approach:** Scraper stores basis per elevator per delivery month. Frontend reads `cbot.json` for live futures. `cash = futures[basisMonth] + basis`. All other scrapers would need to store `basisMonth` too.

### [ ] [FROM: Code] Grain Charts tab — mirror cattle chart architecture — QUEUED 2026-03-25
- **Date queued:** 2026-03-25
- **Task:** Add a Charts tab to the Grain module, mirroring the cattle charts architecture
- **Why:** Cattle now has Futures/Auction toggle, 5-year history, seasonal pattern, insights, sale calendar. Grain has none of this — the data is already in `futures-history.json` (ZC, ZS, ZM daily) but no charts exist.
- **Scope:**
  - Futures view: corn nearby, soybeans nearby, soybean meal, corn/soy spread charts with 7D–5Y range selection
  - Seasonal pattern for corn (compute from ZC 5yr monthly, same methodology as cattle)
  - Insights: trend analysis, range position, spread direction
  - Grain-specific companion panel (e.g. basis trend from scraped data, planting progress calendar)
  - No "Auction" equivalent needed — grain doesn't have barn-style auctions
- **Data ready:** `futures-history.json` already includes ZC, ZS, ZM daily. May need to add ZC monthly to the scraper for seasonal analysis.

---

## Pending Decisions

### 1. Hog data display — DEFERRED
- **Context:** Central parser already captures hog data (market hogs, sows, boars) from Wednesday reports. Data is stored in history/index but not shown in the PWA.
- **Status:** Not urgent, not on the radar. Future build when needed.

### 2. Remaining barn parsers
- **Context:** 2 of 5 configured barns (Sleepy Eye, Pipestone) have no parser — they return `pending`. Rock Creek completed 2026-03-24. Lanesboro completed 2026-03-25.
- **Decision needed:** Priority order for remaining two? Do Sleepy Eye or Pipestone publish online reports?

### 3. Herd / Fields / Finance modules
- **Context:** All three are placeholder stubs (2-line JS files). The tab structure exists in `index.html` but no content.
- **Decision needed:** What should these modules contain? Any priority among them?

### 4. Jennie-O parser — COMPLETED 2026-03-24
- **Context:** Old source (aghostportal.com) blocked by robots.txt. New source found: farmbucks.com.
- **Result:** Parser rewritten for farmbucks.com, re-enabled, cash-only (no basis). Contract badge shows delivery month. v1.83–v1.85.

### 5. About page — data sources update
- **Context:** CLAUDE.md says to update `#about-sources` when adding new parsers. Need to verify CHS, MVG, AGP, Jennie-O are listed. New Vision will also need to be added once parser is complete.
- **Action:** Check `index.html` `#about-sources` section and update if any sources are missing.

### 6. ADM Mankato — no dedicated parser
- **Context:** New Vision Cooperative lists ADM Mankato as a location. No dedicated ADM scraper exists. New Vision will be the only price source for this location.
- **Decision needed:** Is a dedicated ADM parser worth building later? ADM is a major buyer in southern MN.
- **Status:** Flagged. New Vision covers it for now.

---

## Known Issues

### Commit messages v1.54–v1.64
- Many commits have placeholder message "your commit message here" — the PS1 script wasn't reading `$MSG` correctly. Fixed in v1.65 but historical messages are lost.

---

## Completed

- ✅ [Chat] Rock Creek parser prompt finalized — 2026-03-24
- ✅ [Code] Rock Creek parser built, validated, YTD catch-up complete — 2026-03-24 (v1.66–v1.82)
- ✅ [Code] Jennie-O parser rewritten for farmbucks.com, re-enabled — 2026-03-24 (v1.83–v1.85)
- ✅ [Chat] New Vision Cooperative parser prompt finalized — 2026-03-24 (robots.txt clear, 22 locations, overlaps mapped)
- ✅ [Code] New Vision parser built, validated, 22/22 locations with data — 2026-03-25 (v1.87–v1.101)
- ✅ [Code] Frontend: dynamic CBOT labels, scraped CBOT fallback, green badge, blank empties — 2026-03-25 (v1.100–v1.101)
- ✅ [Code] Lanesboro Sales Commission parser built — Wed slaughter + Top Producers, Fri feeder, HTML scrape — 2026-03-25 (v1.106–v1.114)
- ✅ [Code] Trend modal fix: sale day count uses actual data points not total entries — 2026-03-25 (v1.114)
- ✅ [Code] Yahoo Finance migration: replaced Stooq with Yahoo for all futures cards, cached batch fetch, exchange timestamps — 2026-03-25 (v1.115)
- ✅ [Code] Cattle charts overhaul: real 5yr historical data, server-side scraper, Futures/Auction toggle, seasonal pattern, insights, sale calendar, expanded range buttons — 2026-03-25 (v1.116)
- ✅ [Code] Al-Corn grain parser built — CIH widget, corn only, Claremont MN, GRAIN_SCRAPE_MAP wired — 2026-03-26 (v1.117–v1.121)
- ✅ [Code] POET Biorefining parser built then shelved — Gradable WAF blocks headless browsers, disabled in config — 2026-03-26 (v1.123–v1.124)
- ✅ [Code] Est. badge + hidden basis for non-scraped buyers, About page + How To updates — 2026-03-26 (v1.125)