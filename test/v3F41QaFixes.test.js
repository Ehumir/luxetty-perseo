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
  CONVERSATION_STAGES,
  CONVERSATION_GOALS,
  ADVISOR_CONTACT_CONSENT,
} = require('../conversation/v3');
const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');
const { extractAffirmationName } = require('../conversation/v3/interpreter/identityNameParser');
const { parseAdvisorContactConsent } = require('../conversation/v3/planner/consentParser');
const { evaluateV3PrimaryGate } = require('../config/perseoV3Flags');

describe('F4.1 QA fixes', () => {
  it('Ana: valuación sin precio — no repite expected_price y marca valuation_requested', () => {
    const cid = 'f41-ana-valuation';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'Quiero vender mi casa' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Ana' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'En San Pedro' });
    const r = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Es lo que no sé. Necesito que hagan la valuación ustedes.',
    });
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.SELL_PROPERTY);
    assert.equal(r.state.valuationRequested, true);
    assert.notEqual(r.state.awaitingField, 'expected_price');
    assert.doesNotMatch(String(r.reply || ''), /qu[eé]\s+precio\s+esperado/i);
    assert.match(String(r.reply || ''), /valuaci[oó]n|asesor/i);
    const legacy = mapV3StateToLegacyAiState(r.state);
    assert.equal(legacy.valuation_requested, true);
    assert.equal(legacy.price_unknown, true);
  });

  it('Sí, Luisa y Luisa, ya te dije guardan full_name sin repetir nombre', () => {
    assert.equal(extractAffirmationName('Sí, Luisa'), 'Luisa');
    assert.equal(extractAffirmationName('Si Luisa'), 'Luisa');
    assert.equal(extractAffirmationName('Luisa, ya te dije'), 'Luisa');

    const cid = 'f41-luisa-name';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'Quiero vender mi casa' });
    const r = processV3Turn({ conversationId: cid, phone: '521', text: 'Sí, Luisa' });
    assert.equal(r.state.collectedFields?.fullName, 'Luisa');
    assert.doesNotMatch(String(r.reply || ''), /c[oó]mo\s+te\s+llamas|tu\s+nombre/i);
    const r2 = processV3Turn({ conversationId: cid, phone: '521', text: 'Luisa, ya te dije' });
    assert.equal(r2.state.collectedFields?.fullName, 'Luisa');
    assert.doesNotMatch(String(r2.reply || ''), /c[oó]mo\s+te\s+llamas/i);
  });

  it('PROPERTY_INQUIRY LUX-A0470 + consent → crm_payload_ready y CRM_READY', () => {
    const cid = 'f41-prop-crm';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'LUX-A0470' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Jorge' });
    processV3Turn({ conversationId: cid, phone: '521', text: '¿Cuánto cuesta?' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Quiero un asesor' });
    const r = processV3Turn({ conversationId: cid, phone: '521', text: 'Sí' });
    assert.equal(r.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
    assert.equal(r.state.qualificationComplete, true);
    assert.equal(r.state.crmPayloadReady, true);
    assert.equal(r.state.conversationStage, CONVERSATION_STAGES.CRM_READY);
    assert.ok(r.state.crmPayloadPreview);
    const legacy = mapV3StateToLegacyAiState(r.state);
    assert.equal(legacy.crm_payload_ready, true);
    assert.equal(legacy.advisor_contact_consent, 'ACCEPTED');
  });

  it('bot + me parece muy bien + sí — sin fallback repetido ni Lamento la confusión', () => {
    assert.equal(parseAdvisorContactConsent('me parece muy bien'), 'ACCEPTED');

    const cid = 'f41-bot-soft';
    clearV3Session(cid);
    const r0 = processV3Turn({ conversationId: cid, phone: '521', text: '¿Eres bot?' });
    assert.match(String(r0.reply), /asesor\s+IA\s+de\s+Luxetty/i);
    const r1 = processV3Turn({ conversationId: cid, phone: '521', text: 'me parece muy bien' });
    assert.doesNotMatch(String(r1.reply), /Lamento la confusi[oó]n/i);
    assert.notEqual(r1.forcedHandoffReason, 'out_of_catalog');
    const r2 = processV3Turn({ conversationId: cid, phone: '521', text: 'sí' });
    assert.doesNotMatch(String(r2.reply), /Lamento la confusi[oó]n/i);
    assert.notEqual(r2.forcedHandoffReason, 'intent_unknown');
    const fallbacks = [r0, r1, r2].filter((r) => r.forcedHandoffReason).length;
    assert.ok(fallbacks <= 1, `expected at most one forced fallback, got ${fallbacks}`);
  });

  it('consent blando en HANDOFF_PENDING: de acuerdo / perfecto', () => {
    const cid = 'f41-soft-consent';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'Busco casa en Cumbres' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Laura' });
    processV3Turn({ conversationId: cid, phone: '521', text: '6 millones' });
    const r = processV3Turn({ conversationId: cid, phone: '521', text: 'me parece muy bien' });
    assert.equal(r.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
    assert.doesNotMatch(String(r.reply), /Lamento la confusi[oó]n/i);
  });

  it('no flip oferta/demanda tras venta con valuación', () => {
    const cid = 'f41-no-flip';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'Quiero vender mi casa' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Ana' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Monterrey' });
    const r = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'No sé el precio, necesito valuación de ustedes',
    });
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.SELL_PROPERTY);
    assert.equal(r.state.leadFlow, 'offer');
    assert.notEqual(r.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
  });

  it('legacy gate off sin impacto', () => {
    const prev = process.env.PERSEO_V3_ENABLED;
    const prevList = process.env.PERSEO_V3_QA_ALLOWLIST;
    process.env.PERSEO_V3_ENABLED = 'false';
    process.env.PERSEO_V3_QA_ALLOWLIST = '';
    try {
      assert.equal(evaluateV3PrimaryGate({ phone: '521' }).v3_primary_allowed, false);
    } finally {
      if (prev === undefined) delete process.env.PERSEO_V3_ENABLED;
      else process.env.PERSEO_V3_ENABLED = prev;
      if (prevList === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
      else process.env.PERSEO_V3_QA_ALLOWLIST = prevList;
    }
  });
});
