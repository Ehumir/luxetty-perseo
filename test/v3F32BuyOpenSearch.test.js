'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PREV_HANDOFF = process.env.PERSEO_V3_HANDOFF_ENABLED;
const PREV_CRM = process.env.PERSEO_V3_CRM_DRY_RUN;
const PREV_V3 = process.env.PERSEO_V3_ENABLED;

before(() => {
  process.env.PERSEO_V3_HANDOFF_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_DRY_RUN = 'true';
  process.env.PERSEO_V3_ENABLED = 'true';
});

after(() => {
  if (PREV_HANDOFF === undefined) delete process.env.PERSEO_V3_HANDOFF_ENABLED;
  else process.env.PERSEO_V3_HANDOFF_ENABLED = PREV_HANDOFF;
  if (PREV_CRM === undefined) delete process.env.PERSEO_V3_CRM_DRY_RUN;
  else process.env.PERSEO_V3_CRM_DRY_RUN = PREV_CRM;
  if (PREV_V3 === undefined) delete process.env.PERSEO_V3_ENABLED;
  else process.env.PERSEO_V3_ENABLED = PREV_V3;
});

const {
  processV3Turn,
  clearV3Session,
  CONVERSATION_GOALS,
  CONVERSATION_STAGES,
} = require('../conversation/v3');
const { evaluateV3PrimaryGate } = require('../config/perseoV3Flags');
const { evaluateGeoCoverage } = require('../conversation/v3/rules/geoPolicy');
const { evaluateBuyPricePolicy } = require('../conversation/v3/rules/pricePolicy');
const { buildCrmDryRunPayload } = require('../conversation/v3/crm/payloadBuilder');
const { detectForcedHandoffReason } = require('../conversation/v3/planner/forcedHandoffDetector');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');
const { createEmptyDecision } = require('../conversation/v3/types/conversationDecision');
const { runForcedHandoffTurn } = require('../conversation/v3/core/forcedHandoffTurn');

function turn(cid, text) {
  return processV3Turn({ conversationId: cid, phone: '5218119000001', text });
}

describe('F3.2 geoPolicy', () => {
  it('San Pedro cubierto, CDMX fuera', () => {
    assert.equal(evaluateGeoCoverage('San Pedro').status, 'covered');
    assert.equal(evaluateGeoCoverage('CDMX').status, 'out_of_coverage');
  });
});

describe('F3.2 pricePolicy', () => {
  it('2M compra → below_soft_floor sin bloquear', () => {
    const p = evaluateBuyPricePolicy({ budget: 2_000_000 });
    assert.equal(p.status, 'below_soft_floor');
  });
});

describe('F3.2 BUY_PROPERTY open search', () => {
  it('"Busco casa en Cumbres" → BUY + zona, pide nombre o presupuesto', () => {
    const cid = 'f32-buy-cumbres';
    clearV3Session(cid);
    const r = turn(cid, 'Busco casa en Cumbres');
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.match(String(r.state.locationText || ''), /Cumbres/i);
    assert.ok(
      /presupuesto|nombre|llamas|llama/i.test(String(r.reply)),
      `reply debe pedir presupuesto o nombre: ${r.reply}`
    );
    assert.doesNotMatch(String(r.reply), /dime en una frase/i);
  });

  it('"Busco casa en Cumbres, 6 millones" → zona + budget', () => {
    const cid = 'f32-buy-cumbres-budget';
    clearV3Session(cid);
    const r = turn(cid, 'Busco casa en Cumbres, 6 millones');
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.match(String(r.state.locationText || ''), /Cumbres/i);
    assert.equal(r.state.budget, 6_000_000);
  });

  it('"Jorge" guarda nombre sin tratarlo como zona', () => {
    const cid = 'f32-buy-name';
    clearV3Session(cid);
    turn(cid, 'Busco casa en Cumbres');
    const r = turn(cid, 'Jorge');
    assert.equal(r.state.collectedFields?.fullName, 'Jorge');
    assert.match(String(r.state.locationText || ''), /Cumbres/i);
    assert.notEqual(String(r.state.locationText || '').toLowerCase(), 'jorge');
  });

  it('"3 recámaras" guarda bedrooms', () => {
    const cid = 'f32-buy-bed';
    clearV3Session(cid);
    turn(cid, 'Busco casa en San Pedro');
    turn(cid, 'Ana');
    turn(cid, '5 millones');
    const r = turn(cid, '3 recámaras');
    assert.equal(r.state.bedrooms, 3);
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
  });

  it('"con crédito" → payment_method credit', () => {
    const cid = 'f32-buy-credit';
    clearV3Session(cid);
    turn(cid, 'Quiero comprar casa en Cumbres');
    turn(cid, 'Luis');
    const r = turn(cid, 'con crédito');
    assert.equal(r.state.paymentMethod, 'credit');
  });

  it('"Busco algo de 2 millones" → price policy cordial', () => {
    const cid = 'f32-buy-2m';
    clearV3Session(cid);
    const r = turn(cid, 'Busco algo de 2 millones');
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.equal(r.state.budget, 2_000_000);
    assert.match(String(r.reply), /menos opciones|explorar|presupuesto/i);
  });

  it('"Busco en CDMX" → geo cordial + asesor', () => {
    const cid = 'f32-buy-cdmx';
    clearV3Session(cid);
    const r = turn(cid, 'Busco en CDMX');
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.match(String(r.state.locationText || ''), /CDMX/i);
    assert.match(String(r.reply), /Monterrey|metropolitana|cobertura|asesor/i);
  });

  it('no flip BUY → SELL con mensaje corto "casa"', () => {
    const cid = 'f32-buy-no-flip';
    clearV3Session(cid);
    turn(cid, 'Busco casa en Cumbres');
    const r = turn(cid, 'casa');
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.notEqual(r.state.conversationGoal, CONVERSATION_GOALS.SELL_PROPERTY);
  });

  it('handoff completo sin CRM write real (solo dry-run preview)', () => {
    const cid = 'f32-buy-handoff';
    clearV3Session(cid);
    turn(cid, 'Busco casa en Cumbres, 6 millones');
    turn(cid, 'María');
    turn(cid, 'casa');
    const r = turn(cid, 'sí, que me contacte un asesor');
    assert.equal(r.state.qualificationComplete, true);
    assert.equal(r.state.crmPayloadReady, true);
    assert.equal(r.state.conversationStage, CONVERSATION_STAGES.CRM_READY);
    const payload = buildCrmDryRunPayload(r.state);
    assert.ok(payload);
    assert.equal(payload.intent, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.equal(payload.budget, 6_000_000);
    assert.ok(typeof payload === 'object' && !payload.crm_write);
  });

  it('legacy gate off cuando PERSEO_V3_ENABLED=false', () => {
    const prev = process.env.PERSEO_V3_ENABLED;
    const prevList = process.env.PERSEO_V3_QA_ALLOWLIST;
    process.env.PERSEO_V3_ENABLED = 'false';
    process.env.PERSEO_V3_QA_ALLOWLIST = '';
    try {
      const gate = evaluateV3PrimaryGate({ phone: '5218119000001' });
      assert.equal(gate.v3_primary_allowed, false);
    } finally {
      if (prev === undefined) delete process.env.PERSEO_V3_ENABLED;
      else process.env.PERSEO_V3_ENABLED = prev;
      if (prevList === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
      else process.env.PERSEO_V3_QA_ALLOWLIST = prevList;
    }
  });
});

describe('F3.2 F3.3B forced fallback sigue operativo', () => {
  it('intent_unknown persistente → forced handoff copy', () => {
    let state = createInitialConversationState({ conversationId: 'f32-fb', phone: '521' });
    state = { ...state, unknownIntentStreak: 3, conversationGoalLocked: true, conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY };
    const decision = createEmptyDecision();
    decision.detectedIntent = 'UNKNOWN';
    const reason = detectForcedHandoffReason({ state, decision, text: '???', frustration: { isFrustrated: false } });
    assert.ok(reason);
    const forced = runForcedHandoffTurn({ state, decision, reason });
    assert.match(String(forced.replyText), /asesor|Luxetty/i);
    assert.match(String(forced.replyText), /canalizar|contact/i);
  });
});
