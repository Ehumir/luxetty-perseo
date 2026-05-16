'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { getPerseoEngineRuntime } = require('../config/perseoEngine');
const { getPerseoV3Config, shouldRouteInboundToV3Core } = require('../config/perseoV3Flags');
const { isProductionSafeV3Config } = require('../conversation/v3/contracts/productionIsolation.contract');

describe('V3 engine and flags (F1)', () => {
  it('PERSEO_ENGINE effective is legacy by default', () => {
    const prev = process.env.PERSEO_ENGINE;
    const prevV3 = process.env.PERSEO_V3_ENABLED;
    process.env.PERSEO_ENGINE = 'v3';
    process.env.PERSEO_V3_ENABLED = 'false';

    try {
      const rt = getPerseoEngineRuntime();
      assert.equal(rt.effective, 'legacy');
      assert.equal(rt.v3ReservedIgnored, true);
    } finally {
      if (prev === undefined) delete process.env.PERSEO_ENGINE;
      else process.env.PERSEO_ENGINE = prev;
      if (prevV3 === undefined) delete process.env.PERSEO_V3_ENABLED;
      else process.env.PERSEO_V3_ENABLED = prevV3;
    }
  });

  it('shouldRouteInboundToV3Core is false when V3 disabled', () => {
    const prev = process.env.PERSEO_V3_ENABLED;
    const prevList = process.env.PERSEO_V3_QA_ALLOWLIST;
    process.env.PERSEO_V3_ENABLED = 'false';
    process.env.PERSEO_V3_QA_ALLOWLIST = '';

    try {
      assert.equal(shouldRouteInboundToV3Core('5218119086196'), false);
      const cfg = getPerseoV3Config();
      assert.equal(cfg.enabled, false);
      assert.equal(isProductionSafeV3Config(), true);
    } finally {
      if (prev === undefined) delete process.env.PERSEO_V3_ENABLED;
      else process.env.PERSEO_V3_ENABLED = prev;
      if (prevList === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
      else process.env.PERSEO_V3_QA_ALLOWLIST = prevList;
    }
  });
});
