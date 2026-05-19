'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SUITES = [
  'wa-hardening-p0',
  'media-real-p0',
  'resilience-p0',
  'humanity-wave2-p0',
  'crm-execute-p0',
];

function runSuite(name) {
  const res = spawnSync('node', ['scripts/argos-run-suite.js', '--suite', name], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, PERSEO_ARGOS_ENABLED: 'true', PERSEO_V3_ENABLED: 'true' },
  });
  return { status: res.status, out: res.stdout || '' };
}

describe('argos M3-02 suites', () => {
  const prev = {};

  before(() => {
    for (const k of [
      'PERSEO_POLICY_ENGINE_ENABLED',
      'PERSEO_MESSAGE_PLANNER_ENABLED',
      'PERSEO_MEDIA_INTAKE_V1_ENABLED',
    ]) {
      prev[k] = process.env[k];
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
      assert.equal(status, 0, out.slice(-800));
      assert.match(out, /rate=1\.000/);
    });
  }
});
