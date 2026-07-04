'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseMessageSignals } = require('../conversation/parsers');
const { buildNextState, detectStateChange } = require('../conversation/stateUpdater');
const { mergeContextualSignals } = require('../conversation/contextualMemoryResolver');
const r0 = require('../conversation/r0ContextContinuity');
const antiLoop = require('../conversation/antiLoopGuardrails');
const offerSafe = require('../conversation/offerSafeReply');
const { applyPriorityToSignals } = require('../conversation/conversationPriorityResolver');
const { getDefaultAiState } = require('../conversation/aiState');
const { _private: idx } = require('../index');

function advance(prev, text) {
  let sig = parseMessageSignals(text, prev);
  sig = applyPriorityToSignals(sig, text, prev);
  sig = r0.applyR0StickySignalsGuard(prev, sig, text);
  let next = buildNextState(prev, sig, detectStateChange(prev, sig));
  Object.assign(next, mergeContextualSignals(sig, prev, next, text));
  let reply = idx.buildConsultiveFallbackReply({
    text,
    signals: sig,
    aiState: next,
    contact: null,
    waProfileName: null,
  });
  const fb = antiLoop.applyFallbackStreakRecovery(reply, {
    nextAiState: next,
    text,
    contact: null,
    waProfileName: null,
  });
  reply = fb.reply;
  Object.assign(next, fb.patch);
  const safe = offerSafe.assertOfferSafeReply(reply, next, text);
  reply = safe.reply;
  const near = antiLoop.applyOutboundNearDuplicateGuard(reply, {
    recentOutboundTexts: [],
    userInboundText: text,
    nextAiState: next,
  });
  reply = near.reply;
  return { state: next, reply: String(reply) };
}

describe('offerStickyProtection', () => {
  it('guion Evelin: promover → vender García → proceso → ? sin demanda', () => {
    let st = getDefaultAiState();
    let r;

    ({ state: st, reply: r } = advance(st, 'Buenas noches me comparten información para promover una propiedad'));
    assert.equal(st.lead_flow, 'offer');
    assert.doesNotMatch(r, /búsqueda|presupuesto aproximado|dime un poco más de lo que buscas/i);

    ({ state: st, reply: r } = advance(st, 'Vender una propiedad ubicada en garcia por la reserva'));
    assert.equal(st.lead_flow, 'offer');
    assert.ok(r0.isR0StickySaleCaptureThread(st));
    assert.doesNotMatch(r, /búsqueda|presupuesto aproximado/i);

    ({ state: st, reply: r } = advance(st, 'Cual es el proceso'));
    assert.equal(st.lead_flow, 'offer');
    assert.doesNotMatch(r, /búsqueda|presupuesto aproximado|buscar casa/i);
    assert.match(r, /proceso|prevaluaci|venta|asesor/i);

    ({ state: st, reply: r } = advance(st, '?'));
    assert.equal(st.lead_flow, 'offer');
    assert.doesNotMatch(r, /compras\/rentas|buscas comprar|presupuesto aproximado|búsqueda/i);
  });

  it('reformulateNearDuplicate no pide compra en hilo offer', () => {
    const st = {
      ...getDefaultAiState(),
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: 'García',
    };
    const out = antiLoop.applyOutboundNearDuplicateGuard(
      'Ok, no lo preguntaré igual otra vez. Retomo: ¿compras/rentas o es tema de venta de tu propiedad?',
      {
        recentOutboundTexts: [
          'Ok, no lo preguntaré igual otra vez. Retomo: ¿compras/rentas o es tema de venta de tu propiedad?',
        ],
        userInboundText: '?',
        nextAiState: st,
      },
    );
    assert.doesNotMatch(String(out.reply), /compras\/rentas|buscas comprar/i);
    assert.match(String(out.reply), /venta/i);
  });
});
