#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Validate WA pilot allowlist.
 * Default min=10 (B2). B1: --min=3 or M4_WA_ALLOWLIST_MIN=3
 */

const { validateAllowlist } = require('./staging/stagingAllowlist');
const { parseArgs, printResult, exitCode } = require('./staging/stagingLib');

function main() {
  const args = parseArgs();
  const v = validateAllowlist({ minPilots: args.minPilots });
  const result = {
    ok: v.ok,
    details: {
      file: v.filePath,
      tier: v.tier,
      min_required: v.min_required,
      valid_count: v.valid_count,
      all_parsed: v.all_parsed,
      errors: v.errors,
      pilots: v.pilots.map((p) => ({
        id: p.id,
        phone_masked: `${p.phone_normalized?.slice(0, 5) || '???'}***${p.phone_normalized?.slice(-4) || ''}`,
        carril: p.carril,
        media_cases: p.media_cases,
      })),
      hint:
        args.minPilots <= 3
          ? 'B1: allowlist-b1.local.yaml (3 phones) or allowlist-10.local.yaml with ≥3 valid'
          : 'B2: allowlist-10.local.yaml with 10 real QA phones',
    },
  };
  printResult('staging-wa-allowlist-validate', result, args.json);
  exitCode(result);
}

main();
