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

const { processV3Turn, clearV3Session, CONVERSATION_GOALS } = require('../conversation/v3');
const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');
const { sanitizeV3PrimaryLegacyAiState } = require('../conversation/v3/state/sanitizeV3PrimaryLegacyAiState');
const { extractPropertyListingCode } = require('../conversation/v3/interpreter/propertyListingCode');

describe('F3.2 property code extractor', () => {
  it('normaliza LUX-A y variantes con espacios', () => {
    assert.equal(extractPropertyListingCode('Me interesa LUX-A0462').normalized, 'LUX-A0462');
    assert.equal(extractPropertyListingCode('lux a 0470').normalized, 'LUX-A0470');
    assert.equal(extractPropertyListingCode('propiedad a0453').normalized, 'LUX-A0453');
  });
});

describe('F3.2 campaign intake + anti-drift', () => {
  it('captación vendedor: offer + sale + zona libre', () => {
    const cid = 'f32-sell-z';
    clearV3Session(cid);
    const r = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Hola, cómo me podrían ayudar a vender mi casa en Valle Alto',
    });
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.SELL_PROPERTY);
    assert.equal(r.state.leadFlow, 'offer');
    assert.equal(r.state.operationType, 'sale');
    assert.match(String(r.state.locationText || ''), /Valle Alto/i);
  });

  it('propiedad específica: PROPERTY_INQUIRY + código', () => {
    const cid = 'f32-prop';
    clearV3Session(cid);
    const r = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Hola, me interesa la propiedad LUX-A09001 de Mitras',
    });
    assert.equal(r.state.conversationGoal, CONVERSATION_GOALS.PROPERTY_INQUIRY);
    assert.equal(r.state.propertyListingCode, 'LUX-A09001');
    assert.equal(r.state.leadFlow, 'demand');
    assert.doesNotMatch(String(r.reply), /no encontr/i);
  });

  it('mensaje genérico con headline de campaña', () => {
    const cid = 'f32-gen';
    clearV3Session(cid);
    const r = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Info',
      campaignHeadline: 'Casas en preventa zona norte',
    });
    assert.match(String(r.reply), /Casas en preventa zona norte/i);
    assert.doesNotMatch(String(r.reply), /no encontr/i);
  });

  it('venta no deriva a renta en turno numérico (precio)', () => {
    const cid = 'f32-drift';
    clearV3Session(cid);
    const steps = [
      'Quiero vender mi casa',
      'Ana',
      'En García',
      '8 millones',
      'Libre',
    ];
    let last;
    for (const s of steps) {
      last = processV3Turn({ conversationId: cid, phone: '521', text: s });
    }
    assert.equal(last.state.conversationGoal, CONVERSATION_GOALS.SELL_PROPERTY);
    assert.equal(last.state.operationType, 'sale');
  });

  it('sanitize alinea context_fusion con goal V3', () => {
    const st = {
      v3_primary_active: true,
      conversation_goal: 'SELL_PROPERTY',
      lead_flow: 'offer',
      operation_type: 'sale',
      context_fusion: { normalizedIntent: { category: 'rent_property', confidence: 0.9 } },
    };
    sanitizeV3PrimaryLegacyAiState(st);
    assert.equal(st.context_fusion.normalizedIntent.category, 'sell_property');
  });
});
