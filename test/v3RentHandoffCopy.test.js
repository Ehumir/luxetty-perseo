'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PREV_HANDOFF = process.env.PERSEO_V3_HANDOFF_ENABLED;
const PREV_CRM = process.env.PERSEO_V3_CRM_DRY_RUN;

before(() => {
  process.env.PERSEO_V3_HANDOFF_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_DRY_RUN = 'true';
});

after(() => {
  if (PREV_HANDOFF === undefined) delete process.env.PERSEO_V3_HANDOFF_ENABLED;
  else process.env.PERSEO_V3_HANDOFF_ENABLED = PREV_HANDOFF;
  if (PREV_CRM === undefined) delete process.env.PERSEO_V3_CRM_DRY_RUN;
  else process.env.PERSEO_V3_CRM_DRY_RUN = PREV_CRM;
});

const { processV3Turn, clearV3Session } = require('../conversation/v3');
const { evaluateQualification } = require('../conversation/v3/planner/qualificationPlanner');
const {
  composeHandoffRentDemand,
  composeHandoffBuyDemand,
  composeHandoffOffer,
  isRentDemandHandoffState,
} = require('../conversation/v3/composer/slotTemplates');
const { CONVERSATION_GOALS, CONVERSATION_STAGES, ADVISOR_CONTACT_CONSENT } = require('../conversation/v3/types/constants');

function rentQualificationScript(cid) {
  processV3Turn({
    conversationId: cid,
    phone: '521',
    text: 'Quiero rentar en Cumbres, presupuesto 25 mil, 2 recámaras',
  });
  return processV3Turn({ conversationId: cid, phone: '521', text: 'Jorge' });
}

describe('composeHandoffRentDemand — sin copy de captación', () => {
  it('S4: renta calificada no menciona valuación', () => {
    const state = {
      conversationGoal: CONVERSATION_GOALS.RENT_PROPERTY,
      leadFlow: 'demand',
      operationType: 'rent',
      locationText: 'Cumbres',
      budget: 25_000,
      bedrooms: 2,
      collectedFields: { fullName: 'Jorge' },
    };
    const out = composeHandoffRentDemand(state);
    assert.match(out.responseText, /opciones disponibles/i);
    assert.match(out.responseText, /asesor de Luxetty/i);
    assert.doesNotMatch(out.responseText, /valuaci[oó]n/i);
    assert.doesNotMatch(out.responseText, /vale la pena revisarla bien/i);
    assert.equal(out.awaitingField, 'advisor_contact_consent');
  });

  it('isRentDemandHandoffState distingue demanda vs oferta', () => {
    assert.equal(
      isRentDemandHandoffState({
        conversationGoal: CONVERSATION_GOALS.RENT_PROPERTY,
        leadFlow: 'demand',
        operationType: 'rent',
      }),
      true,
    );
    assert.equal(
      isRentDemandHandoffState({
        conversationGoal: CONVERSATION_GOALS.RENT_OUT_PROPERTY,
        leadFlow: 'offer',
        operationType: 'rent',
      }),
      false,
    );
  });

  it('composeHandoffOffer (captación) sigue mencionando valuación', () => {
    const out = composeHandoffOffer({
      conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      leadFlow: 'offer',
      operationType: 'sale',
      locationText: 'San Pedro',
      collectedFields: { fullName: 'Ana' },
    });
    assert.match(out.responseText, /valuaci[oó]n/i);
  });

  it('composeHandoffBuyDemand no menciona valuación', () => {
    const out = composeHandoffBuyDemand({
      conversationGoal: CONVERSATION_GOALS.BUY_PROPERTY,
      leadFlow: 'demand',
      operationType: 'sale',
      locationText: 'San Pedro',
      budget: 8_000_000,
      collectedFields: { fullName: 'Ana' },
    });
    assert.match(out.responseText, /opciones/i);
    assert.doesNotMatch(out.responseText, /valuaci[oó]n/i);
  });
});

describe('V3 rent handoff E2E (smokes S2–S4)', () => {
  it('S2/S4: primer turno con presupuesto → califica sin repreguntar presupuesto', () => {
    const cid = 'rent-handoff-s4';
    clearV3Session(cid);
    const r = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Quiero rentar, presupuesto 25 mil, 2 recámaras',
    });
    assert.equal(r.state.budget, 25_000);
    assert.equal(r.state.bedrooms, 2);
    const afterZone = processV3Turn({ conversationId: cid, phone: '521', text: 'Cumbres' });
    const afterName = processV3Turn({ conversationId: cid, phone: '521', text: 'Jorge' });
    assert.equal(afterName.state.budget, 25_000);
    const planner = evaluateQualification(afterName.state);
    assert.equal(planner.qualificationComplete, true);
    assert.equal(planner.missingSlots.includes('budget'), false);
    assert.doesNotMatch(String(afterName.reply || ''), /valuaci[oó]n/i);
    assert.doesNotMatch(String(afterZone.reply || ''), /valuaci[oó]n/i);
  });

  it('S3: handoff tras renta calificada', () => {
    const cid = 'rent-handoff-s3';
    clearV3Session(cid);
    rentQualificationScript(cid);
    const handoff = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Ya quiero hablar con un asesor',
    });
    assert.doesNotMatch(String(handoff.reply || ''), /valuaci[oó]n/i);
    const consent = processV3Turn({ conversationId: cid, phone: '521', text: 'Sí' });
    assert.equal(consent.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
    assert.ok(
      consent.state.conversationStage === CONVERSATION_STAGES.HANDOFF_READY ||
        consent.state.conversationStage === CONVERSATION_STAGES.CRM_READY,
    );
  });

  it('S1 compra ambigua no usa copy de renta', () => {
    const cid = 'rent-handoff-s1-buy';
    clearV3Session(cid);
    const r = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: '¡Hola! Busco departamento en San Pedro',
    });
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.doesNotMatch(String(r.reply || ''), /valuaci[oó]n/i);
  });

  it('venta calificada mantiene copy de valuación en handoff', () => {
    const cid = 'rent-handoff-sell';
    clearV3Session(cid);
    const script = [
      'Quiero vender mi casa',
      'Jorge',
      'San Pedro',
      '15 millones',
      'Libre',
    ];
    let last;
    for (const text of script) {
      last = processV3Turn({ conversationId: cid, phone: '521', text });
    }
    assert.equal(evaluateQualification(last.state).qualificationComplete, true);
    assert.match(String(last.reply || ''), /valuaci[oó]n|asesor/i);
  });
});
