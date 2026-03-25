# Current State — grow27

**Version:** 1.85
**Branch:** UserUpdates
**Live site:** https://michael-ticmn.github.io/grow27/
**Last updated:** 2026-03-24

---

## Architecture

Single-page PWA served via GitHub Pages. No build step — vanilla HTML/CSS/JS.

### Frontend
| Module | File | Status |
|--------|------|--------|
| Navigation & utilities | `js/app.js` (176 lines) | Active |
| Markets (grain/cattle/dairy) | `js/markets.js` (~2,900 lines) | Active |
| Barn data loader | `js/data-loader.js` (82 lines) | Active |
| Herd | `js/herd.js` | Placeholder |
| Fields | `js/fields.js` | Placeholder |
| Finance | `js/finance.js` | Placeholder |

### Data Pipeline
| Component | Schedule | Status |
|-----------|----------|--------|
| Barn scraper (Central, Rock Creek) | Daily 4am + 7am CT | Running |
| Grain scraper (CFS, MVG, AGP, CHS, Jennie-O, New Vision) | Mon–Fri 4am + 7am CT | Running (New Vision queued) |
| Auto-push data to main | After each scrape | Running |

### Barn Parsers
| Barn | Parser | Status |
|------|--------|--------|
| Central Livestock (Zumbrota) | `scripts/barns/central.js` | Active — OCR + rep sales, Mon+Wed |
| Lanesboro | `scripts/barns/_default.js` | Pending — no parser |
| Rock Creek (Pine City) | `scripts/barns/rockcreek.js` | Active — PDF parser, Mon+Wed, batch YTD |
| Sleepy Eye | `scripts/barns/_default.js` | Pending — no parser |
| Pipestone | `scripts/barns/_default.js` | Pending — no parser |

### Grain Parsers
| Source | Parser | Locations | Status |
|--------|--------|-----------|--------|
| CFS | `scripts/grain/cfs.js` | 13 | Active |
| MVG | `scripts/grain/mvg.js` | 3 | Active |
| AGP | `scripts/grain/agp.js` | 13 | Active |
| CHS | `scripts/grain/chs.js` | 2 | Active |
| Jennie-O | `scripts/grain/jennieo.js` | 4 | Active — cash-only via farmbucks.com |
| New Vision Coop | `scripts/grain/newvision.js` | 22 | Queued — cash-only, delivery month columns, corn+beans per location |

### Overlap / Gap Notes (New Vision)
| New Vision Location | Overlap | Status |
|---------------------|---------|--------|
| CHS Fairmont | `chs.js` | CHS is primary |
| CHS Mankato | `chs.js` | CHS is primary |
| AGP Sheldon | `agp.js` | AGP is primary |
| ADM Mankato | none | **Gap — no dedicated ADM parser. New Vision is only source.** |
| POET Ashton | none | New Vision only |
| MNSP Brewster | none | New Vision only |

### PWA Modules & Tabs
```
MARKETS
├── Grain: prices, buyers, margin calc, calendar, news
├── Cattle: prices, charts, margin calc, news, barns, lockers
└── Dairy: prices, charts, margin calc, plants, news
HERD — placeholder
FIELDS — placeholder
FINANCE — placeholder
ABOUT — data sources, app info
```

### Key Data Files
- `data/barns-config.json` — 5 barns registered
- `data/grain-config.json` — 6 sources (5 active, New Vision queued)
- `data/prices/index.json` — latest barn snapshot
- `data/prices/grain/index.json` — latest grain snapshot
- History files: no cap (was 14, removed v1.82) — monitor site speed

### Refresh Intervals (frontend)
- Grain/cattle/dairy prices: every 15 min
- Weather: every 30 min
- Barn data: loaded once on init from pre-scraped index
