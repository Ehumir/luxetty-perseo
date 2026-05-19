'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function runSuite(name, envExtra = {}) {
  const env = {
    ...process.env,
    PERSEO_ARGOS_ENABLED: 'true',
    PERSEO_V3_ENABLED: 'true',
    PERSEO_V3_CRM_EXECUTE: 'false',
    PERSEO_V3_HANDOFF_ENABLED: 'true',
    ...envExtra,
  };
  return execFileSync('node', ['scripts/argos-run-suite.js', '--suite', name], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
}

describe('argosM3Media', () => {
  const prev = {};

  before(() => {
    prev.media = process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED;
    prev.policy = process.env.PERSEO_POLICY_ENGINE_ENABLED;
    prev.planner = process.env.PERSEO_MESSAGE_PLANNER_ENABLED;
  });

  after(() => {
    for (const [k, v] of [
      ['PERSEO_MEDIA_INTAKE_V1_ENABLED', prev.media],
      ['PERSEO_POLICY_ENGINE_ENABLED', prev.policy],
      ['PERSEO_MESSAGE_PLANNER_ENABLED', prev.planner],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('media-p0 passes with MEDIA flag ON', () => {
    const out = runSuite('media-p0', { PERSEO_MEDIA_INTAKE_V1_ENABLED: 'true' });
    assert.match(out, /pass=6\/6/);
  });

  it('whatsapp-smoke passes', () => {
    const out = runSuite('whatsapp-smoke', { PERSEO_MEDIA_INTAKE_V1_ENABLED: 'true' });
    assert.match(out, /pass=4\/4/);
  });
});
