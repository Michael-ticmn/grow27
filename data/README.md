# grow27 · data/

Auction barn price data, updated daily by GitHub Actions.

---

## Folder structure

```
data/
  barns-config.json        — barn registry (edit here to add/remove barns)
  README.md                — this file
  prices/
    index.json             — latest snapshot, one entry per barn (PWA reads this)
    central.json           — full history for Central Livestock Association
    lanesboro.json         — full history for Lanesboro Sales Commission
    rockcreek.json         — full history for Rock Creek Livestock Market
    sleepyeye.json         — full history for Sleepy Eye Auction Market
    pipestone.json         — full history for Pipestone Livestock Auction
```

---

## Update schedule

The scraper runs **daily at 7:00am CT** via `.github/workflows/scrape-barns.yml`.
It can also be triggered manually from the Actions tab (`workflow_dispatch`).

On each run the workflow:
1. Scrapes any barn with `hasTypeBreakdown: true` and a `reportUrl`
2. Writes a pending null entry for barns without a report URL
3. Trims history to the last 14 days / 14 entries per barn
4. Regenerates `data/prices/index.json`
5. Commits and pushes changed files to the `UserUpdates` branch

---

## Price sources

| `source` value  | Meaning |
|-----------------|---------|
| `scraped`       | Live data pulled directly from the barn's report page |
| `calculated`    | Derived from a beef baseline using USDA grade discounts |
| `fetch_failed`  | Scrape attempted but failed (network or parse error) |
| `pending`       | No report URL configured for this barn |

---

## Discount schedule applied to scraped beef baseline

| Type      | Slaughter discount | Feeder discount (40% of slaughter) |
|-----------|-------------------|-------------------------------------|
| Beef      | —                 | —                                   |
| Crossbred | −$9.50/cwt        | −$3.80/cwt                          |
| Holstein  | −$30.00/cwt       | −$12.00/cwt                         |

---

## How to add a new barn

1. Open `data/barns-config.json`
2. Append an entry to the array:

```json
{
  "id": "yourkey",
  "name": "Full Barn Name",
  "location": "City ST",
  "reportUrl": null,
  "hasTypeBreakdown": false
}
```

3. Create `data/prices/yourkey.json` using any existing barn file as a template (empty history)
4. Add a matching entry to `data/prices/index.json`
5. Commit and push — the next scraper run picks it up automatically

**To enable live scraping for a new barn:**
- Set `"reportUrl"` to the barn's cattle report page URL
- Set `"hasTypeBreakdown": true`
- Add `"parseRules"` with `slaughter` and `feeder` label strings that match the headings on that page:

```json
"parseRules": {
  "slaughter": {
    "beef":      "Finished Beef Steers",
    "crossbred": "Finished Dairy-X Steers",
    "holstein":  "Finished Dairy Steers"
  },
  "feeder": {
    "beef":     "Feeder Cattle",
    "holstein": "Dairy Steers"
  }
}
```

The scraper uses partial/fuzzy matching — you only need the core label text. Suffixes like "- Lite Test" are stripped automatically for feeder headers. No code changes required.

---

## History entry schema

```json
{
  "date": "2026-03-21",
  "slaughter": {
    "beef": 231.50,
    "crossbred": 222.00,
    "holstein": 201.50
  },
  "feeder": {
    "beef": 354.75,
    "crossbred": 350.95,
    "holstein": 342.75,
    "liteTest": false
  },
  "source": "scraped"
}
```

`liteTest: true` indicates the feeder cattle section that week was labeled "Lite Test" on the barn's report, meaning lighter-framed animals — useful context for interpreting feeder prices.

All prices in **¢/cwt**.
