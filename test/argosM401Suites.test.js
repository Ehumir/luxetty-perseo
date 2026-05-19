'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SUITES = [
  'crm-runtime-p0',
  'media-runtime-p0',
  'runtime-understanding-p0',
  'runtime-resilience-p0',
  'wa-telemetry-p0',
  'learning-runtime-p0',
  'policy-runtime-p0',
];

function runSuite(name) {
  const res = spawnSync('node', ['scripts/argos-run-suite.js', '--suite', name], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PERSEO_ARGOS_ENABLED: 'true', PERSEO_V3_ENABLED: 'true' },
  });
  return { status: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

describe('argos M4-01 suites', () => {
  const prev = {};

  before(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('PERSEO_')) prev[k] = process.env[k];
    }
  });

  after(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  for (const suite of SUITES) {
    it(`${suite} passes locally`, () => {
      const { status, out } = runSuite(suite);
      if (status !== 0) {
        console.error(out.slice(-4000));
      }
      assert.equal(status, 0, `suite ${suite} should pass`);
      assert.match(out, /PASS/);
    });
  }
});
