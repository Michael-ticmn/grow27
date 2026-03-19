# grow27

> *worth more than its weight*

Farm intelligence platform from the #27 operation — grain markets, cattle markets, herd, fields & finance. Built as a progressive web app (PWA) that installs to your phone home screen and works like a native app.

---

## Modules

| Module | Status | Description |
|---|---|---|
| **#27Markets** | ✅ Live | Grain & cattle futures, local cash prices, margin calculators, weather, news |
| **#27Herd** | 🔜 Coming soon | Animal inventory, weights, health records, feeding logs |
| **#27Fields** | 🔜 Coming soon | Acres, inputs, yield tracking, crop planning |
| **#27Finance** | 🔜 Coming soon | P&L, grain contracts, input costs, break-evens |

---

## #27Markets — Grain

- CBOT corn & soybean futures (nearby + new crop) via Stooq
- Local cash prices & basis for curated buyers in southern MN (Area 1: Mountain Lake/Fairmont, Area 2: Northfield/Owatonna)
- OSM-powered nearby elevator discovery within 50 miles
- Grain margin calculator — corn & soybeans, per-acre and full-field
- Midwest weather (Ames, Mankato, Sioux Falls, Rochester + your location)
- USDA & CBOT market calendar
- Morning brief & source links

## #27Markets — Cattle

- CME live cattle, feeder cattle, and corn futures
- Historical price charts (7D / 30D / 90D / 180D)
- Feed-to-finish margin calculator with full herd profitability
- Seasonal price pattern chart
- Livestock auction barns near southern MN (Zumbrota, Lanesboro, Rock Creek, Sleepy Eye, Pipestone)
- Custom meat lockers near Faribault MN
- Morning brief & source links

---

## PWA Install

Once deployed, open the URL in your browser:

- **iPhone:** Safari → Share button → Add to Home Screen
- **Android:** Chrome → three dots → Add to Home Screen

Launches full screen with no browser chrome. Auto-refreshes prices every 15 minutes, weather every 30 minutes.

---

## Setup

### Deploy to GitHub Pages

1. Push all files to the `main` branch root
2. Go to **Settings → Pages**
3. Source: **Deploy from a branch** → `main` → `/ (root)`
4. Your URL: `https://[username].github.io/grow27`

### Icons (required for PWA install icon)

1. Open `generate-icons.html` in your browser
2. Download `icon-32.png`, `icon-192.png`, `icon-512.png`
3. Create an `icons/` folder in the repo and upload all three

### File structure

```
grow27/
├── index.html            ← main app
├── manifest.json         ← PWA manifest
├── sw.js                 ← service worker
├── logo.svg              ← standalone logo
├── generate-icons.html   ← open locally to generate PNG icons
├── README.md
└── icons/
    ├── icon-32.png
    ├── icon-192.png
    └── icon-512.png
```

---

## Data Sources

| Data | Source | Refresh |
|---|---|---|
| Grain & cattle futures | [Stooq](https://stooq.com) | Every 15 min |
| Weather | [Open-Meteo](https://open-meteo.com) | Every 30 min |
| Nearby elevators | [OpenStreetMap Overpass](https://overpass-api.de) | On location |

All sources are free with no API key required.

---

## Brand

**grow27** — lowercase always. The #27 is the operation number, shared with #27 Vineyard.

Colors: amber `#d4a027` · teal `#3ea8aa` · dark `#111214`

---

## License

MIT — see [LICENSE](LICENSE)

© 2026 grow27 · All rights reserved
