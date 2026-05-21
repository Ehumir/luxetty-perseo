#!/usr/bin/env node
'use strict';

/**
 * Publica resultado de suite ARGOS a Supabase (tabla argos_qa_suite_runs en ATENA).
 *
 * Uso:
 *   node scripts/argos-publish-suite-results.js --suite=release-p0 --passed=7 --failed=0 --total=7
 *
 * Requiere: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (mismo proyecto que ATENA)
 */

const { createClient } = require('@supabase/supabase-js');

function parseArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const suiteId = args.suite || args.suite_id;
  if (!suiteId) {
    console.error('Missing --suite=<id>');
    process.exit(1);
  }
  const passed = Number(args.passed || 0);
  const failed = Number(args.failed || 0);
  const total = Number(args.total || passed + failed);
  const status = failed > 0 ? 'fail' : passed === total && total > 0 ? 'pass' : 'partial';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const { error } = await supabase.from('argos_qa_suite_runs').insert({
    suite_id: suiteId,
    suite_label: args.label || suiteId,
    status,
    passed,
    failed,
    total,
    duration_ms: args.duration_ms ? Number(args.duration_ms) : null,
    git_sha: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || null,
    report_path: args.report_path || null,
    payload: { source: 'argos-publish-suite-results', argv: process.argv },
  });
  if (error) {
    console.error('insert_failed', error.message);
    process.exit(1);
  }
  console.log('published', { suiteId, status, passed, failed, total });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
