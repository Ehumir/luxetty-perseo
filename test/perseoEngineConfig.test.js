'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('config/perseoEngine (V3-F0)', () => {
  it('default / unset / legacy → effective legacy, v3 not ignored', (t) => {
    const prev = process.env.PERSEO_ENGINE;
    t.after(() => {
      if (prev === undefined) delete process.env.PERSEO_ENGINE;
      else process.env.PERSEO_ENGINE = prev;
    });
    delete process.env.PERSEO_ENGINE;
    delete require.cache[require.resolve('../config/perseoEngine')];
    const m = require('../config/perseoEngine');
    const r = m.getPerseoEngineRuntime();
    assert.equal(r.requested, 'legacy');
    assert.equal(r.effective, 'legacy');
    assert.equal(r.v3Ignored, false);
  });

  it('PERSEO_ENGINE=v3 → requested v3, effective legacy, v3Ignored true', (t) => {
    const prev = process.env.PERSEO_ENGINE;
    t.after(() => {
      if (prev === undefined) delete process.env.PERSEO_ENGINE;
      else process.env.PERSEO_ENGINE = prev;
    });
    process.env.PERSEO_ENGINE = 'v3';
    delete require.cache[require.resolve('../config/perseoEngine')];
    const m = require('../config/perseoEngine');
    const r = m.getPerseoEngineRuntime();
    assert.equal(r.requested, 'v3');
    assert.equal(r.effective, 'legacy');
    assert.equal(r.v3Ignored, true);
  });

  it('typo maps to legacy requested', (t) => {
    const prev = process.env.PERSEO_ENGINE;
    t.after(() => {
      if (prev === undefined) delete process.env.PERSEO_ENGINE;
      else process.env.PERSEO_ENGINE = prev;
    });
    process.env.PERSEO_ENGINE = 'v99';
    delete require.cache[require.resolve('../config/perseoEngine')];
    const m = require('../config/perseoEngine');
    assert.equal(m.normalizePerseoEngine('v99'), 'legacy');
  });
});
