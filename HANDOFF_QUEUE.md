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

## Pending Decisions

### 1. Hog data display — DEFERRED
- **Context:** Central parser already captures hog data (market hogs, sows, boars) from Wednesday reports. Data is stored in history/index but not shown in the PWA.
- **Status:** Not urgent, not on the radar. Future build when needed.

### 2. Remaining barn parsers
- **Context:** 3 of 5 configured barns (Lanesboro, Sleepy Eye, Pipestone) have no parser — they return `pending`. Rock Creek completed 2026-03-24.
- **Decision needed:** Priority order for remaining three? Do Lanesboro, Sleepy Eye, or Pipestone publish online reports? Use `rockcreek.js` as reference for PDF-based barns.

### 3. Herd / Fields / Finance modules
- **Context:** All three are placeholder stubs (2-line JS files). The tab structure exists in `index.html` but no content.
- **Decision needed:** What should these modules contain? Any priority among them?

### 4. Jennie-O parser — COMPLETED 2026-03-24
- **Context:** Old source (aghostportal.com) blocked by robots.txt. New source found: farmbucks.com.
- **Result:** Parser rewritten for farmbucks.com, re-enabled, cash-only (no basis). Contract badge shows delivery month. v1.83–v1.85.

### 5. About page — data sources update
- **Context:** CLAUDE.md says to update `#about-sources` when adding new parsers. Need to verify CHS, MVG, AGP, Jennie-O are listed.
- **Action:** Check `index.html` `#about-sources` section and update if any sources are missing.

---

## Known Issues

### Commit messages v1.54–v1.64
- Many commits have placeholder message "your commit message here" — the PS1 script wasn't reading `$MSG` correctly. Fixed in v1.65 but historical messages are lost.

---

## Completed

- ✅ [Chat] Rock Creek parser prompt finalized — 2026-03-24
- ✅ [Code] Rock Creek parser built, validated, YTD catch-up complete — 2026-03-24 (v1.66–v1.82)
- ✅ [Code] Jennie-O parser rewritten for farmbucks.com, re-enabled — 2026-03-24 (v1.83–v1.85)