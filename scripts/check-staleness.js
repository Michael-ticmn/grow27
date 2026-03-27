#!/usr/bin/env node
// Check for stale data sources after scraping.
// Usage: node scripts/check-staleness.js barns|grain|futures
// Exits with code 1 if any active source is stale, triggering GitHub Actions failure notification.

const fs = require('fs');
const path = require('path');

const mode = process.argv[2]; // barns, grain, or futures
if (!['barns', 'grain', 'futures'].includes(mode)) {
  console.error('Usage: node scripts/check-staleness.js barns|grain|futures');
  process.exit(2);
}

const THRESHOLDS = { barns: 7, grain: 3, futures: 3 }; // days
const maxDays = THRESHOLDS[mode];
const now = new Date();

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  return Math.floor((now - d) / 86400000);
}

let stale = [];

if (mode === 'futures') {
  const file = path.join(__dirname, '..', 'data', 'prices', 'futures-history.json');
  if (!fs.existsSync(file)) {
    console.error('futures-history.json not found');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const age = daysSince(data.updated);
  if (age > maxDays) {
    stale.push({ id: 'futures-history', lastSuccess: data.updated, age });
  }
} else {
  const indexFile = mode === 'barns'
    ? path.join(__dirname, '..', 'data', 'prices', 'index.json')
    : path.join(__dirname, '..', 'data', 'prices', 'grain', 'index.json');

  if (!fs.existsSync(indexFile)) {
    console.error(indexFile + ' not found');
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));

  for (const entry of index) {
    // Skip sources that aren't expected to have data
    if (entry.source === 'pending') continue;
    if (entry.status === 'directory') continue;

    const age = daysSince(entry.lastSuccess);
    if (age > maxDays) {
      stale.push({ id: entry.id, lastSuccess: entry.lastSuccess || 'never', age });
    }
  }
}

if (stale.length > 0) {
  console.error(`\n⚠️  STALE ${mode.toUpperCase()} SOURCES (threshold: ${maxDays} days)\n`);
  for (const s of stale) {
    const ageStr = s.age === Infinity ? 'never scraped' : `${s.age} days ago`;
    console.error(`  ${s.id}: last success ${s.lastSuccess} (${ageStr})`);
  }
  console.error('');
  process.exit(1);
} else {
  console.log(`✓ All ${mode} sources fresh (within ${maxDays} days)`);
}
