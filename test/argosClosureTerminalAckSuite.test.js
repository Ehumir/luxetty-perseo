'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

describe('argos closure-terminal-ack-p0', () => {
  it('closure-terminal-ack-p0 suite passes locally', () => {
    const root = path.join(__dirname, '..');
    const out = execFileSync('node', ['scripts/argos-run-suite.js', '--suite', 'closure-terminal-ack-p0'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PERSEO_ARGOS_ENABLED: 'true',
        PERSEO_V3_ENABLED: 'true',
        PERSEO_V3_CRM_EXECUTE: 'false',
      },
    });
    assert.match(out, /pass=6\/6/);
  });
});
