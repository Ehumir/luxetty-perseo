'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('config/perseoEngine + perseoV3Flags (F1/F2)', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env = { ...saved };
    delete require.cache[require.resolve('../config/perseoEngine')];
    delete require.cache[require.resolve('../config/perseoV3Flags')];
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('motor efectivo siempre legacy en F2', () => {
    process.env.PERSEO_ENGINE = 'v3';
    process.env.PERSEO_V3_ENABLED = 'true';
    delete require.cache[require.resolve('../config/perseoEngine')];
    const { getPerseoEngineRuntime } = require('../config/perseoEngine');
    const r = getPerseoEngineRuntime();
    assert.equal(r.effective, 'legacy');
    assert.equal(r.requested, 'v3');
  });

  it('shouldRouteInboundToV3Core solo con allowlist + enabled', () => {
    delete require.cache[require.resolve('../config/perseoV3Flags')];
    const m = require('../config/perseoV3Flags');
    process.env.PERSEO_V3_ENABLED = 'false';
    process.env.PERSEO_V3_QA_ALLOWLIST = '5218110000001';
    assert.equal(m.shouldRouteInboundToV3Core('5218110000001'), false);
    process.env.PERSEO_V3_ENABLED = 'true';
    delete require.cache[require.resolve('../config/perseoV3Flags')];
    const m2 = require('../config/perseoV3Flags');
    assert.equal(m2.shouldRouteInboundToV3Core('5218110000001'), true);
    assert.equal(m2.shouldRouteInboundToV3Core('5219999999999'), false);
  });
});
