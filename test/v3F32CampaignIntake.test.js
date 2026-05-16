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

const {
  processV3Turn,
  clearV3Session,
  CONVERSATION_GOALS,
  ADVISOR_CONTACT_CONSENT,
} = require('../conversation/v3');
const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');
const { sanitizeV3PrimaryLegacyAiState } = require('../conversation/v3/state/sanitizeV3PrimaryLegacyAiState');
const { extractPropertyListingCode } = require('../conversation/v3/interpreter/propertyListingCode');
const { isAwaitingIdentityName } = require('../conversation/v3/interpreter/nameHeuristics');

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

describe('F3.2 Luxetty tone + identity + compuesto (propiedad específica)', () => {
  it('isAwaitingIdentityName reconoce tono profesional (no “cómo te llam…”)', () => {
    const base = { collectedFields: {}, awaitingField: null };
    assert.equal(
      isAwaitingIdentityName({
        ...base,
        lastAssistantReply: 'Perfecto. Para la referencia LUX-A0462, ¿me compartes tu nombre?',
      }),
      true,
    );
    assert.equal(
      isAwaitingIdentityName({
        ...base,
        lastAssistantQuestion: '¿Con quién tengo el gusto?',
      }),
      true,
    );
    assert.equal(
      isAwaitingIdentityName({ ...base, awaitingField: 'full_name' }),
      true,
    );
  });

  it('V3 propiedad LUX-A0462: reply no usa “cómo te llamo/llamas”; pide nombre con tono Luxetty', () => {
    const cid = 'f32-tone-a0462';
    clearV3Session(cid);
    const r1 = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Hola, me interesa la propiedad LUX-A0462',
    });
    const reply1 = String(r1.reply || '');
    assert.doesNotMatch(reply1, /cómo te llamo/i);
    assert.doesNotMatch(reply1, /cómo te llamas/i);
    assert.match(reply1, /compartes tu nombre/i);
    assert.equal(r1.state.propertyListingCode, 'LUX-A0462');
    assert.equal(r1.state.conversationGoal, CONVERSATION_GOALS.PROPERTY_INQUIRY);
    assert.equal(r1.state.leadFlow, 'demand');
    assert.equal(r1.state.operationType, 'sale');
    assert.equal(r1.state.propertySpecificIntent, true);
  });

  it('tras pregunta de nombre, “Jorge” guarda full_name y conserva código', () => {
    const cid = 'f32-name-jorge';
    clearV3Session(cid);
    processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Me interesa LUX-A0462',
    });
    const r2 = processV3Turn({ conversationId: cid, phone: '521', text: 'Jorge' });
    assert.equal(r2.state.collectedFields?.fullName, 'Jorge');
    assert.equal(r2.state.propertyListingCode, 'LUX-A0462');
    assert.doesNotMatch(String(r2.reply || ''), /cómo te llamo/i);
    assert.doesNotMatch(String(r2.reply || ''), /cómo te llamas/i);
  });

  it('mensaje compuesto “Jorge. Sí que me contacten” guarda nombre + consentimiento', () => {
    const cid = 'f32-compound-consent';
    clearV3Session(cid);
    processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Propiedad LUX-A0462 por favor',
    });
    const r2 = processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Jorge. Sí que me contacten',
    });
    assert.equal(r2.state.collectedFields?.fullName, 'Jorge');
    assert.equal(r2.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
    assert.equal(r2.state.propertyListingCode, 'LUX-A0462');
  });

  it('“Jorge, sí” en un turno acepta asesor y conserva nombre', () => {
    const cid = 'f32-compound-si';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'LUX-A0462 me interesa' });
    const r2 = processV3Turn({ conversationId: cid, phone: '521', text: 'Jorge, sí' });
    assert.equal(r2.state.collectedFields?.fullName, 'Jorge');
    assert.equal(r2.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
  });

  it('“Jorge por WhatsApp” guarda nombre y preferencia de canal', () => {
    const cid = 'f32-name-wa';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'Interesa LUX-A0462' });
    const r2 = processV3Turn({ conversationId: cid, phone: '521', text: 'Jorge por WhatsApp' });
    assert.equal(r2.state.collectedFields?.fullName, 'Jorge');
    assert.equal(r2.state.channelPreference, 'whatsapp');
    const legacy = mapV3StateToLegacyAiState(r2.state);
    assert.equal(legacy.channel_preference, 'whatsapp');
    assert.equal(legacy.property_code, 'LUX-A0462');
  });

  it('tras oferta de asesor: “Sí” y “Por WhatsApp” marcan consentimiento / canal', () => {
    const cidSi = 'f32-handoff-si';
    clearV3Session(cidSi);
    processV3Turn({ conversationId: cidSi, phone: '521', text: 'LUX-A0462' });
    processV3Turn({ conversationId: cidSi, phone: '521', text: 'Ana' });
    processV3Turn({
      conversationId: cidSi,
      phone: '521',
      text: 'Sí, quiero que un asesor me contacte para revisar la propiedad',
    });
    const rSi = processV3Turn({ conversationId: cidSi, phone: '521', text: 'Sí' });
    assert.equal(rSi.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);

    const cidWa = 'f32-handoff-wa';
    clearV3Session(cidWa);
    processV3Turn({ conversationId: cidWa, phone: '521', text: 'LUX-A0462' });
    processV3Turn({ conversationId: cidWa, phone: '521', text: 'Luis' });
    processV3Turn({
      conversationId: cidWa,
      phone: '521',
      text: 'Me gustaría hablar con un asesor sobre la referencia',
    });
    const rWa = processV3Turn({ conversationId: cidWa, phone: '521', text: 'Por WhatsApp' });
    assert.equal(rWa.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
    assert.equal(rWa.state.channelPreference, 'whatsapp');
  });

  it('“Va” tras oferta de asesor acepta contacto', () => {
    const cid = 'f32-handoff-va';
    clearV3Session(cid);
    processV3Turn({ conversationId: cid, phone: '521', text: 'LUX-A0462' });
    processV3Turn({ conversationId: cid, phone: '521', text: 'Marta' });
    processV3Turn({
      conversationId: cid,
      phone: '521',
      text: 'Quiero coordinar con un asesor, por favor',
    });
    const r = processV3Turn({ conversationId: cid, phone: '521', text: 'Va' });
    assert.equal(r.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
  });
});
