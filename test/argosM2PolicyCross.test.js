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

describe('argosM2PolicyCross', () => {
  const prev = {};

  before(() => {
    prev.policy = process.env.PERSEO_POLICY_ENGINE_ENABLED;
    prev.planner = process.env.PERSEO_MESSAGE_PLANNER_ENABLED;
  });

  after(() => {
    if (prev.policy === undefined) delete process.env.PERSEO_POLICY_ENGINE_ENABLED;
    else process.env.PERSEO_POLICY_ENGINE_ENABLED = prev.policy;
    if (prev.planner === undefined) delete process.env.PERSEO_MESSAGE_PLANNER_ENABLED;
    else process.env.PERSEO_MESSAGE_PLANNER_ENABLED = prev.planner;
  });

  it('release-p0 passes with M2 flags OFF', () => {
    const out = runSuite('release-p0', {
      PERSEO_POLICY_ENGINE_ENABLED: 'false',
      PERSEO_MESSAGE_PLANNER_ENABLED: 'false',
    });
    assert.match(out, /pass=7\/7/);
  });

  it('release-p1 passes with M2 flags OFF', () => {
    const out = runSuite('release-p1', {
      PERSEO_POLICY_ENGINE_ENABLED: 'false',
      PERSEO_MESSAGE_PLANNER_ENABLED: 'false',
    });
    assert.match(out, /pass=11\/11/);
  });

  it('policy-p0 passes with M2 flags ON', () => {
    const out = runSuite('policy-p0', {
      PERSEO_POLICY_ENGINE_ENABLED: 'true',
      PERSEO_MESSAGE_PLANNER_ENABLED: 'true',
    });
    assert.match(out, /pass=8\/8/);
  });

  it('cross-intent-p0 passes with M2 flags ON', () => {
    const out = runSuite('cross-intent-p0', {
      PERSEO_POLICY_ENGINE_ENABLED: 'true',
      PERSEO_MESSAGE_PLANNER_ENABLED: 'true',
    });
    assert.match(out, /pass=6\/6/);
  });

  it('humanity-policy-p0 passes with M2 flags ON', () => {
    const out = runSuite('humanity-policy-p0', {
      PERSEO_POLICY_ENGINE_ENABLED: 'true',
      PERSEO_MESSAGE_PLANNER_ENABLED: 'true',
    });
    assert.match(out, /pass=2\/2/);
  });

  it('release-p0 passes with M2 flags ON (no regression)', () => {
    const out = runSuite('release-p0', {
      PERSEO_POLICY_ENGINE_ENABLED: 'true',
      PERSEO_MESSAGE_PLANNER_ENABLED: 'true',
    });
    assert.match(out, /pass=7\/7/);
  });

  it('release-p1 passes with M2 flags ON (no regression)', { timeout: 120_000 }, () => {
    const out = runSuite('release-p1', {
      PERSEO_POLICY_ENGINE_ENABLED: 'true',
      PERSEO_MESSAGE_PLANNER_ENABLED: 'true',
    });
    assert.match(out, /pass=11\/11/);
  });
});
