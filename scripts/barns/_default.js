// scripts/barns/_default.js
// Default barn parser — placeholder for barns without custom parsing logic.
// Returns a pending result. As new barns get report URLs and parsing logic,
// create a new file (e.g. pipestone.js) following the same interface as central.js.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

async function parse({ id }) {
  console.log(`[${id}] no custom parser — returning pending`);
  return {
    slaughter: null,
    feeder:    null,
    source:    'pending',
    error:     null
  };
}

module.exports = { parse };
