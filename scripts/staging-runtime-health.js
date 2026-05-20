#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { parseArgs, printResult, exitCode } = require('./staging/stagingLib');
const { buildRuntimeHealthSnapshot, resetRuntimeMetrics, recordMetric } = require('../conversation/v3/runtime/observability/runtimeMetricsCollector');

async function main() {
  const args = parseArgs();
  process.env.PERSEO_RUNTIME_OBSERVABILITY_ENABLED = 'true';
  resetRuntimeMetrics();
  recordMetric('loop_score', { score: 0.2, force: true });
  recordMetric('retry', { count: 1, force: true });
  const health = buildRuntimeHealthSnapshot();
  const result = { ok: true, details: { health } };
  printResult('staging-runtime-health', result, args.json);
  exitCode(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
