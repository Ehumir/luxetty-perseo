#!/usr/bin/env node
'use strict';

/**
 * M4-04 — Replay pack smoke (RPACK_001).
 * Usage: node scripts/staging-replay-smoke.js [packId] [--json]
 */

require('dotenv').config();

const { parseArgs, printResult, exitCode } = require('./staging/stagingLib');
const { runReplayPackById } = require('../argos/replay/replayEngine');

async function main() {
  const args = parseArgs();
  const packId = args.positional[0] || 'RPACK_001';

  process.env.PERSEO_REPLAY_ENGINE_ENABLED = 'true';
  process.env.PERSEO_ARGOS_ENABLED = 'true';
  process.env.PERSEO_V3_ENABLED = 'true';

  const out = await runReplayPackById(packId, { force: true });

  const result = {
    ok: out.ok === true,
    details: {
      pack_id: packId,
      turns: out.turns,
      violations: out.violations,
      last_snapshot: out.last_snapshot,
    },
  };

  printResult('staging-replay-smoke', result, args.json);
  exitCode(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
