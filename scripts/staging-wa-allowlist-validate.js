#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Validate WA pilot allowlist (no placeholders, 10 unique MX numbers).
 */

const { validateAllowlist } = require('./staging/stagingAllowlist');
const { parseArgs, printResult, exitCode } = require('./staging/stagingLib');

function main() {
  const args = parseArgs();
  const v = validateAllowlist();
  const result = {
    ok: v.ok,
    details: {
      file: v.filePath,
      pilot_count: v.pilots.length,
      errors: v.errors,
      pilots: v.pilots.map((p) => ({
        id: p.id,
        phone_masked: `${p.phone_normalized?.slice(0, 5) || '???'}***${p.phone_normalized?.slice(-4) || ''}`,
        carril: p.carril,
        media_cases: p.media_cases,
      })),
      hint: 'Copy allowlist-10.local.yaml.example → allowlist-10.local.yaml with real QA phones (gitignored)',
    },
  };
  printResult('staging-wa-allowlist-validate', result, args.json);
  exitCode(result);
}

main();
