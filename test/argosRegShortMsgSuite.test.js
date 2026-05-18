'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

describe('argosRegShortMsgSuite', () => {
  it('reg-short-msg-p0 suite passes locally', () => {
    process.env.PERSEO_ARGOS_ENABLED = 'true';
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_V3_CRM_EXECUTE = 'false';
    const out = execFileSync('node', ['scripts/argos-run-suite.js', '--suite', 'reg-short-msg-p0'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: process.env,
    });
    assert.match(out, /pass=1\/1/);
  });
});
