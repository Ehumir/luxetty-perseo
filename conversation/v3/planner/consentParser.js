'use strict';

const { normalizeText } = require('../../../utils/text');

/**
 * @param {string} text
 * @returns {'ACCEPTED'|'DECLINED'|null}
 */
function parseAdvisorContactConsent(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return null;

  const decline =
    /^(no|nop|nah|nel|despues|después|luego|ahora no|mejor no)\b/.test(t) ||
    t.includes('no quiero') ||
    t.includes('no me contact') ||
    t.includes('sin asesor');
  if (decline) return 'DECLINED';

  const accept =
    /^(si|sí|claro|vale|ok|va|esta bien|está bien|de acuerdo|adelante|por favor)\b/.test(t) ||
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
  return (
    state.awaitingField === 'advisor_contact_consent' ||
    state.advisorContactConsent === 'REQUESTED'
  );
}

module.exports = {
  parseAdvisorContactConsent,
  shouldParseConsentTurn,
};
