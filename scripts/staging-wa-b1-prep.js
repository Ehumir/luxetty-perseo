#!/usr/bin/env node
'use strict';

/**
 * M4-04B — Print prep steps + validate allowlist (3 pilots).
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { validateAllowlist } = require('./staging/stagingAllowlist');

const CHECKLIST = path.join(__dirname, '../docs/runbooks/M4-04B-wa-pilot-checklist.md');

function main() {
  console.log('\n=== M4-04B WA B1 — Prep ===\n');
  const v = validateAllowlist({ minPilots: 3 });
  if (!v.ok) {
    console.log('FAIL allowlist:', v.errors.join('; '));
    console.log('\nFix: docs/argos/whatsapp-smoke/m4-02/allowlist-b1.local.yaml\n');
    process.exit(1);
  }
  console.log(`OK allowlist (${v.valid_count} pilots): ${v.filePath}\n`);
  for (const p of v.pilots) {
    console.log(`  - ${p.id}: ${p.carril} — ${p.objetivo}`);
  }
  console.log('\nHuman checklist:', CHECKLIST);
  console.log('\nAfter 3 WA conversations:\n  npm run staging:wa-collect\n  npm run staging:close:wa-b1\n');
  process.exit(0);
}

main();
