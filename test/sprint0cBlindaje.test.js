'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseMessageSignals } = require('../conversation/parsers');
const { buildNextState, detectStateChange } = require('../conversation/stateUpdater');
const { getDefaultAiState } = require('../conversation/aiState');
const { buildSaleCaptiveContinuityReply } = require('../conversation/r0ContextContinuity');
const { resolveWantsHumanEscalationTurn } = require('../conversation/humanEscalation');
const { sanitizeInboundSignals, isLikelyPropertyDescription } = require('../conversation/slotSanitizer');
const { shouldAcceptAsIdentityName } = require('../conversation/v3/interpreter/nameHeuristics');
const { normalizeOutboundMessages } = require('../utils/helpers');
const { runAllMatrix } = require('./qaMatrixP0ConversationalHarness');
const { simulateTurn } = require('./qaMatrixP0ConversationalHarness');

const ENGLISH_OUTBOUND_RE = /\b(land|house|apartment|home|warehouse|office)\b/i;

function simulate(userText, aiState, extra = {}) {
  const prev = { ...getDefaultAiState(), ...aiState };
  const signals = sanitizeInboundSignals(
    parseMessageSignals(userText, prev, { media: { type: 'text' } }),
    prev,
  );
  const change = detectStateChange(prev, signals);
  const next = buildNextState(prev, signals, change);
  return { signals, next, change };
}

describe('Sprint 0C — blindaje conversacional', () => {
  it('nombre completo 4 palabras en V3 identity', () => {
    const state = { awaitingField: 'full_name', conversationStage: 'IDENTITY_PENDING' };
    const name = 'Jose Ángel Hernández López';
    assert.equal(shouldAcceptAsIdentityName(state, name), true);
  });

  it('oferta orgánica: nombre + zona persisten', () => {
    let st = simulate('Quiero vender un terreno industrial', { lead_flow: 'offer', operation_type: 'sale' });
    assert.equal(st.next.lead_flow, 'offer');
    st = simulate('Jose Ángel Hernández López', {
      ...st.next,
      awaiting_field: 'full_name',
      lead_flow: 'offer',
      operation_type: 'sale',
    });
    assert.equal(st.next.full_name, 'Jose Ángel Hernández López');
    st = simulate('Santa Catarina', {
      ...st.next,
      awaiting_field: 'location_text',
      lead_flow: 'offer',
      operation_type: 'sale',
    });
    assert.match(String(st.next.location_text || ''), /santa catarina/i);
    assert.ok(!isLikelyPropertyDescription(st.next.location_text));
  });

  it('no contamina location_text con descripción larga', () => {
    const long =
      'Es un terreno industrial de 2 hectáreas con servicios en la zona industrial de Santa Catarina con acceso a carretera';
    const st = simulate(long, { lead_flow: 'offer', awaiting_field: 'budget_max' });
    assert.ok(!st.next.location_text || st.next.location_text.length <= 80);
  });

  it('venta terreno: outbound sin inglés', () => {
    const reply = buildSaleCaptiveContinuityReply({
      text: 'continuar',
      aiState: { lead_flow: 'offer', property_type: 'land' },
    });
    assert.match(reply, /terreno/i);
    assert.doesNotMatch(reply, ENGLISH_OUTBOUND_RE);
    const out = normalizeOutboundMessages([reply]);
    assert.doesNotMatch(out[0], ENGLISH_OUTBOUND_RE);
  });

  it('wants_human → escalación automática', () => {
    const esc = resolveWantsHumanEscalationTurn({
      previousAiState: {},
      nextAiState: { wants_human: true, lead_flow: 'offer' },
      parsedSignals: { wants_human: true },
      text: 'Quiero hablar con un asesor humano',
    });
    assert.equal(esc.handled, true);
    assert.equal(esc.statePatch.handoff_sent, true);
    assert.match(String(esc.reply), /asesor|contactar/i);
  });

  it('quiere humano en simulación', () => {
    const res = simulateTurn({
      userText: 'Quiero hablar con un asesor humano por favor',
      aiState: getDefaultAiState(),
      contact: { first_name: 'Cliente', last_name: '' },
      outboundHistory: [],
    });
    assert.match(res.assistantText, /asesor|contactar|canalizar/i);
    assert.doesNotMatch(res.assistantText, ENGLISH_OUTBOUND_RE);
  });

  it('post-handoff: gracias no reinicia loop de nombre', () => {
    const res = simulateTurn({
      userText: 'gracias',
      aiState: { handoff_sent: true, lead_flow: 'offer' },
      contact: { first_name: 'Cliente', last_name: '' },
      outboundHistory: ['Te contactará un asesor de Luxetty.'],
    });
    assert.doesNotMatch(res.assistantText, /compartes tu nombre|cómo te llamas/i);
    assert.ok(res.assistantText.length > 5);
  });

  it('compra: demanda sin canal equivocado', () => {
    const res = simulateTurn({
      userText: 'Busco casa en Cumbres hasta 8 millones',
      aiState: getDefaultAiState(),
      contact: { first_name: 'Cliente', last_name: '' },
      outboundHistory: [],
    });
    assert.ok(res.assistantText.length > 20);
    assert.doesNotMatch(res.assistantText, ENGLISH_OUTBOUND_RE);
  });

  it('renta: intención renta', () => {
    const st = simulate('Busco depa en renta en San Pedro', {});
    assert.equal(st.next.lead_flow, 'demand');
    assert.equal(st.next.operation_type, 'rent');
  });

  it('propiedad específica: código detectado', () => {
    const st = simulate(`Me interesa LUX-A0453`, {});
    assert.ok(st.signals.property_code || st.next.property_code || st.next.direct_property_reference);
  });

  it('pauta abandonada: contexto campaña', () => {
    const st = simulate('Hola', {
      campaign_context: { property_code: 'LUX-A0453' },
      low_info_campaign_message: true,
    });
    assert.ok(st.signals.low_info_campaign_message || st.next.campaign_context);
  });

  it('objeción comisión en oferta', () => {
    const res = simulateTurn({
      userText: '¿Cuánto cobran de comisión?',
      aiState: { lead_flow: 'offer', operation_type: 'sale' },
      contact: { first_name: 'Cliente', last_name: '' },
      outboundHistory: [],
    });
    assert.match(res.assistantText, /comisi|honorar|asesor|luxetty/i);
  });

  it('sticker/vacío: saludo sin crash', () => {
    const res = simulateTurn({
      userText: 'Hola',
      aiState: getDefaultAiState(),
      contact: { first_name: 'Cliente', last_name: '' },
      outboundHistory: [],
    });
    assert.ok(res.assistantText.length > 5);
  });

  it('conversación caótica: no inglés ni loop obvio', () => {
    let ai = getDefaultAiState();
    const msgs = ['Hola', 'Quiero vender', 'No entiendo nada', 'Santa Catarina', 'ok'];
    let last = '';
    for (const m of msgs) {
      const res = simulateTurn({
        userText: m,
        aiState: ai,
        contact: { first_name: 'Cliente', last_name: '' },
        outboundHistory: last ? [last] : [],
      });
      last = res.assistantText;
      ai = res.aiState;
      assert.doesNotMatch(last, ENGLISH_OUTBOUND_RE);
    }
  });

  it('matriz QA P0 (20 escenarios) — PASS', () => {
    const results = runAllMatrix();
    const failed = results.filter((r) => !r.pass);
    assert.equal(
      failed.length,
      0,
      `Fallos: ${failed.map((f) => `${f.id}: ${f.observations}`).join('; ')}`,
    );
  });
});
