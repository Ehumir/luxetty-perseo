'use strict';

/**
 * Sticky offer impermeable: ninguna recovery puede volver a demanda.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const r0 = require('./r0ContextContinuity');

const DEMAND_LEAK_SNIPPETS = [
  'sigo con tu busqueda',
  'sigo con tu búsqueda',
  'buscar casa',
  'presupuesto aproximado',
  'presupuesto maximo',
  'presupuesto máximo',
  'compras/rentas',
  'compras o rentas',
  'buscas comprar',
  'comprar, rentar o vender',
  'comprar o rentar',
  'es compra o renta',
];

function hasDemandLeak(reply = '') {
  const t = normalizeText(String(reply || ''));
  if (!t) return false;
  return DEMAND_LEAK_SNIPPETS.some((s) => t.includes(normalizeText(s)));
}

function buildOfferSafeFallback(aiState = {}, userText = '') {
  const st = aiState && typeof aiState === 'object' ? aiState : {};
  const loc = cleanSpaces(String(st.location_text || ''));
  if (r0.isSaleProcessQuestion(userText)) {
    return r0.buildSaleCaptiveContinuityReply({
      text: userText,
      aiState: st,
      loc,
      hasValidHumanName: !!cleanSpaces(String(st.full_name || '')),
    });
  }
  return r0.buildSaleCaptiveContinuityReply({
    text: userText || 'continuar',
    aiState: st,
    loc,
    hasValidHumanName: !!cleanSpaces(String(st.full_name || '')),
  });
}

/**
 * @returns {{ reply: string, enforced: boolean, reason: string|null }}
 */
function assertOfferSafeReply(reply, aiState = {}, userText = '') {
  if (!r0.isR0StickySaleCaptureThread(aiState)) {
    return { reply, enforced: false, reason: null };
  }
  if (!hasDemandLeak(reply)) {
    return { reply, enforced: false, reason: null };
  }
  return {
    reply: buildOfferSafeFallback(aiState, userText),
    enforced: true,
    reason: 'offer_sticky_blocked_demand_leak',
  };
}

module.exports = {
  DEMAND_LEAK_SNIPPETS,
  hasDemandLeak,
  buildOfferSafeFallback,
  assertOfferSafeReply,
};
