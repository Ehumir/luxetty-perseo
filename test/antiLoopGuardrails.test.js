'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const antiLoop = require('../conversation/antiLoopGuardrails');
const { getDefaultAiState } = require('../conversation/aiState');

describe('antiLoopGuardrails (P0.1)', () => {
  it('detecta frustración por frases comunes', () => {
    assert.equal(antiLoop.detectConversationalFrustration('Ya te dije que quiero vender').frustrated, true);
    assert.equal(antiLoop.detectConversationalFrustration('Otra vez me preguntas lo mismo').frustrated, true);
    assert.equal(antiLoop.detectConversationalFrustration('Lee bien por favor').frustrated, true);
    assert.equal(antiLoop.detectConversationalFrustration('hola??').frustrated, true);
    assert.equal(antiLoop.detectConversationalFrustration('Busco en Cumbres').frustrated, false);
  });

  it('no promueve full_name desde frase larga tipo “Hola busco casa…”', () => {
    const ai = { ...getDefaultAiState(), awaiting_field: 'full_name', full_name: null, lead_flow: 'demand' };
    const sig = { full_name: null, owner_relation: null };
    const patch = antiLoop.buildStaleAwaitingFieldPatch(
      ai,
      sig,
      'Hola, busco casa en Cumbres',
      null
    );
    assert.equal(Object.keys(patch).length, 0, 'no debe limpiar awaiting ni setear nombre basura');
  });

  it('limpia awaiting full_name con token “Jorge”', () => {
    const ai = { ...getDefaultAiState(), awaiting_field: 'full_name', full_name: null, lead_flow: 'demand' };
    const sig = { full_name: null, owner_relation: null };
    const patch = antiLoop.buildStaleAwaitingFieldPatch(ai, sig, 'Jorge', null);
    assert.equal(patch.awaiting_field, null);
    assert.equal(patch.full_name, 'Jorge');
  });

  it('applyFallbackStreakRecovery no escala con hola → info (bucket genérico compartido)', () => {
    const next = {
      ...getDefaultAiState(),
      anti_loop_last_fallback_bucket: 'generic_help',
      anti_loop_fallback_streak: 1,
      anti_loop_last_inbound_short_intent: 'greeting_hola',
    };
    const r1 = antiLoop.applyFallbackStreakRecovery('Hola, claro. Te puedo ayudar. Dime en una frase qué necesitas y lo revisamos.', {
      nextAiState: next,
      text: 'info',
      contact: null,
      waProfileName: null,
    });
    assert.doesNotMatch(String(r1.reply), /Perdona si se sintió repetido/i);
    assert.equal(r1.patch.anti_loop_fallback_streak, 1);
  });

  it('applyFallbackStreakRecovery sí escala si el usuario repite el mismo saludo y el bucket sigue igual', () => {
    const next = {
      ...getDefaultAiState(),
      anti_loop_last_fallback_bucket: 'generic_help',
      anti_loop_fallback_streak: 1,
      anti_loop_last_inbound_short_intent: 'greeting_hola',
    };
    const r1 = antiLoop.applyFallbackStreakRecovery('Hola, claro. Te puedo ayudar. Dime en una frase qué necesitas y lo revisamos.', {
      nextAiState: next,
      text: 'hola',
      contact: null,
      waProfileName: null,
    });
    assert.match(String(r1.reply), /Perdona|repetido|Entiendo|Sigo contigo/i);
    assert.equal(r1.patch.anti_loop_fallback_streak, 0);
  });

  it('applyOutboundNearDuplicateGuard reformula generic_help repetido', () => {
    const next = {
      ...getDefaultAiState(),
      lead_flow: 'demand',
      location_text: 'Cumbres',
      anti_loop_recent_question_types: ['generic_help', 'generic_help'],
    };
    const out = antiLoop.applyOutboundNearDuplicateGuard(
      'Hola, claro. Te puedo ayudar. Dime en una frase qué necesitas y lo revisamos.',
      {
        recentOutboundTexts: [],
        userInboundText: 'info',
        nextAiState: next,
      }
    );
    assert.doesNotMatch(String(out.reply), /dime en una frase qué necesitas/i);
    assert.match(String(out.reply), /Cumbres|compra o renta/i);
  });

  it('recordTurnAntiLoopMeta acumula tipos y firmas', () => {
    const next = { ...getDefaultAiState(), anti_loop_recent_question_types: [], anti_loop_last_outbound_sigs: [] };
    antiLoop.recordTurnAntiLoopMeta(next, '¿Me compartes tu nombre?', 'engine_v2_advisor');
    assert.ok(next.anti_loop_recent_question_types.includes('name'));
    assert.ok((next.anti_loop_last_outbound_sigs || []).length >= 1);
  });
});

describe('index enforceNameCapture + frustración (P0.1)', () => {
  it('no concatena insistencia de nombre si el usuario muestra frustración', () => {
    const { _private } = require('../index');
    const out = _private.enforceNameCapture('Gracias. ¿Te parece si seguimos?', {
      contact: null,
      aiState: { ...getDefaultAiState(), awaiting_field: 'full_name', full_name: null, lead_flow: 'demand' },
      waProfileName: null,
      recentOutboundTexts: [],
      userInboundText: 'Ya te dije que me llamo Ana',
      leadFlow: 'demand',
      inboundFrustration: { frustrated: true, markers: ['ya_te_dije'] },
      hasValidHumanNameFn: () => false,
    });
    assert.match(String(out.reply), /Tienes razón|perdona|Retomo/i);
    assert.equal(out.statePatch?.awaiting_field, null);
  });
});
