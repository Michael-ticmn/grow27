// scripts/grain/_default.js
// Fallback parser for grain sources without a custom module.
// Returns pending status so the orchestrator records the attempt.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

async function parse({ id }) {
  console.log(`[${id}] default parser — no custom logic, returning pending`);
  return {
    locations: {},
    source: 'pending',
    error: null,
  };
}

module.exports = { parse };
