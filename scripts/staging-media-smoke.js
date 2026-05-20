#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Media hardening + fail-open smoke (local deterministic).
 * Usage: node scripts/staging-media-smoke.js [--json]
 */

require('dotenv').config();

const { parseArgs, printResult, exitCode } = require('./staging/stagingLib');
const { validateInboundMedia, applyMediaHardeningToMedia } = require('../conversation/v3/runtime/mediaHardening');
const { withTimeout } = require('../services/inboundMediaV3Bridge');

async function main() {
  const args = parseArgs();
  process.env.PERSEO_MEDIA_HARDENING_ENABLED = 'true';
  process.env.PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED = 'true';

  const cases = [];

  const oversized = validateInboundMedia({ kind: 'image', byte_size: 20_000_000 }, { force: true });
  cases.push({ name: 'oversized', ok: oversized.ok === false, reject: oversized.reject_reason });

  const badMime = validateInboundMedia({ kind: 'document', mime_type: 'application/x-foo' }, { force: true });
  cases.push({ name: 'bad_mime', ok: badMime.ok === false });

  const corrupt = applyMediaHardeningToMedia({ kind: 'audio', corrupt_audio: true }, { force: true });
  cases.push({ name: 'corrupt_audio', ok: corrupt.verdict.ok === false, fail_open: corrupt.media.fail_open_applied });

  const timeout = await withTimeout(
    new Promise((resolve) => setTimeout(() => resolve('late'), 50)),
    20,
    'test',
  );
  cases.push({ name: 'timeout_graceful', ok: timeout.timed_out === true });

  const allOk = cases.every((c) => c.ok);

  const result = {
    ok: allOk,
    details: { cases, note: 'WA real media requires manual pilot execution' },
  };

  printResult('staging-media-smoke', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
