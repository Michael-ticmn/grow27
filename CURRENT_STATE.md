# Current State — grow27

**Version:** 1.116
**Branch:** UserUpdates
**Live site:** https://michael-ticmn.github.io/grow27/
**Last updated:** 2026-03-26

---

## Architecture

Single-page PWA served via GitHub Pages. No build step — vanilla HTML/CSS/JS.

### Frontend
| Module | File | Status |
|--------|------|--------|
| Navigation & utilities | `js/app.js` (176 lines) | Active |
| Markets (grain/cattle/dairy) | `js/markets.js` (~3,500 lines) | Active |
| Barn data loader | `js/data-loader.js` (82 lines) | Active |
| Herd | `js/herd.js` | Placeholder |
| Fields | `js/fields.js` | Placeholder |
| Finance | `js/finance.js` | Placeholder |

### Data Pipeline
| Component | Schedule | Status |
|-----------|----------|--------|
| Barn scraper (Central, Lanesboro, Rock Creek) | Daily 4am + 7am CT | Running |
| Grain scraper (CFS, MVG, AGP, CHS, Jennie-O, New Vision) | Mon–Fri 4am + 7am CT | Running |
| Auto-push data to main | After each scrape | Running |

### Barn Parsers
| Barn | Parser | Status |
|------|--------|--------|
| Central Livestock (Zumbrota) | `scripts/barns/central.js` | Active — OCR + rep sales, Mon+Wed |
| Lanesboro Sales Commission | `scripts/barns/lanesboro.js` | Active — HTML parser, Wed (slaughter + Top Producers) + Fri (feeder) |
| Rock Creek (Pine City) | `scripts/barns/rockcreek.js` | Active — PDF parser, Mon+Wed, batch YTD |
| Sleepy Eye | `scripts/barns/_default.js` | Pending — no parser |
| Pipestone | `scripts/barns/_default.js` | Pending — no parser |

### Grain Parsers
| Source | Parser | Locations | Status |
|--------|--------|-----------|--------|
| CFS | `scripts/grain/cfs.js` | 13 | Active — DTN Cashbid widget |
| MVG | `scripts/grain/mvg.js` | 3 | Active |
| AGP | `scripts/grain/agp.js` | 13 | Active |
| CHS | `scripts/grain/chs.js` | 2 | Active |
| Jennie-O | `scripts/grain/jennieo.js` | 4 | Active — cash-only via farmbucks.com |
| New Vision | `scripts/grain/newvision.js` | 22 | Active — AgriCharts JSON API, corn+beans, basis+basisMonth stored |

### Overlap / Gap Notes (New Vision)
| New Vision Location | Overlap | Status |
|---------------------|---------|--------|
| CHS Fairmont | `chs.js` | CHS is primary |
| CHS Mankato | `chs.js` | CHS is primary |
| AGP Sheldon | `agp.js` | AGP is primary |
| ADM Mankato | none | **Gap — no dedicated ADM parser. New Vision is only source.** |
| POET Ashton | none | New Vision only |
| MNSP Brewster | none | New Vision only |

### CBOT Futures Display
| Source | Usage | Status |
|--------|-------|--------|
| Yahoo Finance (client-side, `ZC=F` etc.) | Real-time price cards — cached batch fetch, 10-min TTL | Active |
| `data/prices/futures-history.json` | Historical charts + seasonal — scraped daily by GitHub Actions | Active |
| Scraped grain data (CFS, AGP, etc.) | Override — `parseCbotNotation()` extracts CBOT from bid data | Active |

### Data Pipeline
| Component | Schedule | Status |
|-----------|----------|--------|
| Barn scraper (Central, Lanesboro, Rock Creek) | Daily 4am + 7am CT | Running |
| Grain scraper (CFS, MVG, AGP, CHS, Jennie-O, New Vision) | Mon–Fri 4am + 7am CT | Running |
| Futures history scraper (LE, GF, ZC, ZS, DC, ZM) | Mon–Fri 5pm + 7pm CT | New |
| Auto-push data to main | After each scrape | Running |

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
- `data/grain-config.json` — 6 sources (all active)
- `data/prices/index.json` — latest barn snapshot
- `data/prices/grain/index.json` — latest grain snapshot
- History files: no cap (was 14, removed v1.82) — monitor site speed

### Refresh Intervals (frontend)
- Futures price cards: Yahoo Finance client-side, cached 10 min (prefetched at startup)
- Futures charts + seasonal: `futures-history.json`, loaded once per session (~264KB, scraped daily)
- Scraped grain/barn data: loaded once on init from pre-scraped index
- Weather: every 30 min
