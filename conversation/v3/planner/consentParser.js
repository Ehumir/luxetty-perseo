'use strict';

const { normalizeText } = require('../../../utils/text');
const { CONVERSATION_STAGES, ADVISOR_CONTACT_CONSENT } = require('../types/constants');

/**
 * @param {string} text
 * @returns {'ACCEPTED'|'DECLINED'|null}
 */
function parseAdvisorContactConsent(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return null;

  if (/no\s+me\s+est[aá]s?\s+entendiendo|no\s+entiendes|no\s+est[aá]s?\s+entendiendo/i.test(t)) {
    return null;
  }

  const decline =
    /^(no\s+gracias|no\s+quiero|nop|nah|nel|despues|después|luego|ahora no|mejor no)\b/.test(t) ||
    /^no$/i.test(t) ||
    t.includes('no quiero') ||
    t.includes('no me contact') ||
    t.includes('sin asesor');
  if (decline) return 'DECLINED';

  const accept =
    /^(si|sí|claro|vale|ok|va|esta bien|está bien|de acuerdo|adelante|por favor)\b/.test(t) ||
    /^(perfecto|excelente|genial|muy bien)\b/.test(t) ||
    /\b(me parece\s+(?:muy\s+)?bien|muy bien|de acuerdo)\b/.test(t) ||
    t.includes('que me contacte') ||
    t.includes('que me contacten') ||
    t.includes('contacten') ||
    t.includes('contacte') ||
    /\bpor\s+whatsapp\b/.test(t) ||
    (t.includes('asesor') && (t.includes('si') || t.includes('sí') || t.startsWith('si,')));
  if (accept) return 'ACCEPTED';

  return null;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function shouldParseConsentTurn(state) {
  /** F3.3A: sin `awaitingField` explícito no interpretamos “sí/ok” como consentimiento (evita loops en PROPERTY_QA). */
  if (state.awaitingField === 'advisor_contact_consent') return true;
  if (
    (state.conversationStage === CONVERSATION_STAGES.HANDOFF_PENDING ||
      state.handoffStage === CONVERSATION_STAGES.HANDOFF_PENDING) &&
    state.advisorContactConsent === ADVISOR_CONTACT_CONSENT.REQUESTED
  ) {
    return true;
  }
  return false;
}

module.exports = {
  parseAdvisorContactConsent,
  shouldParseConsentTurn,
};
