'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PREV_V3 = process.env.PERSEO_V3_ENABLED;
const PREV_ALLOWLIST = process.env.PERSEO_V3_QA_ALLOWLIST;

before(() => {
  process.env.PERSEO_V3_ENABLED = 'true';
  process.env.PERSEO_V3_QA_ALLOWLIST = '5218119086196';
});

after(() => {
  if (PREV_V3 === undefined) delete process.env.PERSEO_V3_ENABLED;
  else process.env.PERSEO_V3_ENABLED = PREV_V3;
  if (PREV_ALLOWLIST === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
  else process.env.PERSEO_V3_QA_ALLOWLIST = PREV_ALLOWLIST;
});

const { processV3Turn, clearV3Session, CONVERSATION_GOALS } = require('../conversation/v3');

function firstGoal(text) {
  const cid = `hotfix-${text.slice(0, 12).replace(/\W/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
  clearV3Session(cid);
  const r = processV3Turn({ conversationId: cid, phone: '5218119086196', text });
  return r.state.conversationGoal;
}

describe('hotfix demand vs sell classification', () => {
  const buyCases = [
    'Busco casa en Cumbres',
    'Estoy buscando casa',
    'Quiero comprar casa',
    'Me interesa comprar',
    'Busco casa de 5 millones',
  ];

  for (const text of buyCases) {
    it(`"${text}" → BUY_PROPERTY`, () => {
      assert.equal(firstGoal(text), CONVERSATION_GOALS.BUY_PROPERTY);
    });
  }

  it('"Busco departamento en renta" → RENT_PROPERTY', () => {
    assert.equal(firstGoal('Busco departamento en renta'), CONVERSATION_GOALS.RENT_PROPERTY);
  });

  it('"Quiero vender mi casa" → SELL_PROPERTY', () => {
    assert.equal(firstGoal('Quiero vender mi casa'), CONVERSATION_GOALS.SELL_PROPERTY);
  });
});
