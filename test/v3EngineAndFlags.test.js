'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('config/perseoEngine + perseoV3Flags (F1)', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env = { ...saved };
    delete require.cache[require.resolve('../config/perseoEngine')];
    delete require.cache[require.resolve('../config/perseoV3Flags')];
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('motor efectivo siempre legacy en F1', () => {
    process.env.PERSEO_ENGINE = 'v3';
    process.env.PERSEO_V3_ENABLED = 'true';
    delete require.cache[require.resolve('../config/perseoEngine')];
    const { getPerseoEngineRuntime } = require('../config/perseoEngine');
    const r = getPerseoEngineRuntime();
    assert.equal(r.effective, 'legacy');
    assert.equal(r.requested, 'v3');
  });

  it('shouldRouteInboundToV3Core false si falta flag o engine', () => {
    delete require.cache[require.resolve('../config/perseoV3Flags')];
    const m = require('../config/perseoV3Flags');
    process.env.PERSEO_V3_ENABLED = 'false';
    process.env.PERSEO_ENGINE = 'v3';
    assert.equal(m.shouldRouteInboundToV3Core(), false);
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_ENGINE = 'legacy';
    delete require.cache[require.resolve('../config/perseoV3Flags')];
    const m2 = require('../config/perseoV3Flags');
    assert.equal(m2.shouldRouteInboundToV3Core(), false);
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_ENGINE = 'v3';
    delete require.cache[require.resolve('../config/perseoV3Flags')];
    const m3 = require('../config/perseoV3Flags');
    assert.equal(m3.shouldRouteInboundToV3Core(), true);
  });
});
