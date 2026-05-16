'use strict';

const { cleanSpaces } = require('../../../utils/text');
const { FORBIDDEN_COMPOSER_PATTERNS } = require('../types/constants');
const { HUMAN_ESCALATION_REASONS } = require('../types/forcedHandoffReasons');
const { ADVISOR_CONTACT_CONSENT } = require('../types/constants');

function assertForcedHandoffQuality(text) {
  const s = String(text || '');
  for (const p of FORBIDDEN_COMPOSER_PATTERNS) {
    if (p.test(s)) return false;
  }
  if (!/\b(asesor|asesora)\b/i.test(s)) return false;
  if (!/\b(canalizar|canalizaci[oó]n)\b/i.test(s)) return false;
  if (!/\b(contactar[aá]|escribir[aá]|seguimiento)\b/i.test(s)) return false;
  return s.trim().length > 0;
}

function firstName(state) {
  const full = cleanSpaces(String(state.collectedFields?.fullName || ''));
  if (!full) return null;
  return full.split(/\s+/)[0];
}

/**
 * Copy obligatorio F3.3B — reconocimiento + canalización + contacto WhatsApp.
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} reason
 */
function composeForcedHandoffFallback(state, reason) {
  const nm = firstName(state);
  const greet = nm ? `Entiendo, ${nm}.` : 'Entiendo.';
  const empathy =
    HUMAN_ESCALATION_REASONS.has(reason) || reason === 'frustration_high'
      ? ' Lamento la confusión.'
      : reason === 'media_unsupported'
        ? ' Por aquí no puedo procesar ese tipo de mensaje con detalle.'
        : reason === 'legal_escalation'
          ? ' Este tema requiere criterio humano especializado.'
          : '';

  let body = `${greet}${empathy} Para ayudarte bien con esto, voy a canalizar tu caso con un asesor de Luxetty. En breve te contactará por WhatsApp para continuar contigo y afinar los detalles.`;

  let awaitingField = null;
  const consent = state.advisorContactConsent;

  if (
    consent !== ADVISOR_CONTACT_CONSENT.ACCEPTED &&
    reason !== 'user_requests_human' &&
    reason !== 'runtime_error'
  ) {
    body = `${body} ¿Está bien si te contactan por este mismo número?`;
    awaitingField = 'advisor_contact_consent';
  }

  if (!assertForcedHandoffQuality(body)) {
    body =
      'Entiendo. Para ayudarte bien, voy a canalizar tu caso con un asesor de Luxetty. En breve te contactará por WhatsApp para darte seguimiento.';
  }

  return {
    responseText: cleanSpaces(body),
    followUpQuestion: null,
    awaitingField,
    toneFlags: { consultive: true, forcedHandoff: true, reason },
  };
}

module.exports = {
  composeForcedHandoffFallback,
  assertForcedHandoffQuality,
};
