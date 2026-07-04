'use strict';

/**
 * Contrato: PERSEO no inicia hilos fríos con frases de chatbot genérico.
 */

const { normalizeText, cleanSpaces } = require('../../utils/text');

const FORBIDDEN_OPENING_SNIPPETS = [
  'dime un poco mas',
  'dime un poco más',
  'dime un poco mas de lo que buscas',
  'dime un poco más de lo que buscas',
  'que buscas',
  'qué buscas',
  'como puedo ayudarte',
  'cómo puedo ayudarte',
  'en que te puedo ayudar',
  'en qué te puedo ayudar',
  'te oriento',
  'claro, te ayudo. dime un poco',
];

const SAFE_OPENING_REPLIES = {
  greeting: 'Hola, soy el asistente de Luxetty. ¿Te apoyo con compra, venta o renta de una propiedad?',
  meta_general:
    'Gracias por escribirnos. ¿Vienes por alguna propiedad en particular o prefieres hablar con un asesor?',
  social_reference:
    'Gracias por contactarnos. ¿Qué fue lo que llamó tu atención de Luxetty?',
  seller_capture:
    'Claro, te puedo orientar con la venta de tu propiedad. ¿En qué colonia o municipio está?',
  default:
    'Hola, soy el asistente de Luxetty. ¿Te apoyo con compra, venta o renta, o prefieres hablar con un asesor?',
};

function isColdOpeningContext(context = {}) {
  const st = context.aiState && typeof context.aiState === 'object' ? context.aiState : {};
  if (st.handoff_sent || st.wants_human) return false;
  if (st.lead_flow === 'offer' || st.lead_flow === 'demand') return false;
  if (st.property_code || st.direct_property_code || st.property_specific_intent) return false;
  const openingType = context.opening_type || st.opening_type || null;
  if (openingType && ['greeting', 'meta_general', 'social_reference'].includes(openingType)) {
    return true;
  }
  return !st.lead_flow;
}

function findForbiddenOpeningSnippet(reply = '') {
  const t = normalizeText(String(reply || ''));
  if (!t) return null;
  for (const snippet of FORBIDDEN_OPENING_SNIPPETS) {
    if (t.includes(normalizeText(snippet))) return snippet;
  }
  return null;
}

/**
 * @returns {{ allowed: boolean, reason?: string, safeReply?: string }}
 */
function assertOpeningReplyAllowed(reply, context = {}) {
  if (!isColdOpeningContext(context)) {
    return { allowed: true };
  }
  const hit = findForbiddenOpeningSnippet(reply);
  if (!hit) return { allowed: true };

  const openingType = context.opening_type || context.aiState?.opening_type || 'default';
  const safeReply =
    SAFE_OPENING_REPLIES[openingType] || SAFE_OPENING_REPLIES.default;

  return {
    allowed: false,
    reason: `forbidden_opening_snippet:${hit}`,
    safeReply,
  };
}

function enforceOpeningContract(reply, context = {}) {
  const check = assertOpeningReplyAllowed(reply, context);
  if (check.allowed) {
    return { reply, enforced: false, reason: null };
  }
  return {
    reply: check.safeReply,
    enforced: true,
    reason: check.reason,
  };
}

module.exports = {
  FORBIDDEN_OPENING_SNIPPETS,
  SAFE_OPENING_REPLIES,
  isColdOpeningContext,
  findForbiddenOpeningSnippet,
  assertOpeningReplyAllowed,
  enforceOpeningContract,
};
