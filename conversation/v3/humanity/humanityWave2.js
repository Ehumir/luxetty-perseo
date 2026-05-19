'use strict';

const { normalizeText } = require('../../../utils/text');
const { isHumanityWave2Enabled } = require('../../../config/perseoM302Flags');
const { detectFrustration } = require('../interpreter/frustrationDetector');

const RAPPORT_PREFIXES = [
  'Entiendo, ',
  'Claro, ',
  'Perfecto, ',
  'Gracias por compartirlo. ',
];

const EMPATHY_LINES = {
  frustration: 'Lamento la confusión; vamos paso a paso.',
  urgency: 'Veo que es urgente para ti; te ayudo a avanzar rápido.',
  price_objection: 'Es válido cuidar el presupuesto; veamos opciones realistas.',
  confusion: 'No te preocupes, lo vamos ordenando juntos.',
};

/**
 * @param {{ state: object, text?: string, replyText: string, decision?: object }} input
 */
function applyHumanityWave2Reply(input) {
  if (!isHumanityWave2Enabled()) return input.replyText;

  let reply = String(input.replyText || '').trim();
  if (!reply) return reply;

  const state = input.state || {};
  const text = String(input.text || state.lastUserText || '');
  const t = normalizeText(text);
  const fr = detectFrustration(text);

  let tone = 'neutral';
  if (fr.isFrustrated) tone = 'frustration';
  else if (/\b(urgente|rapido|rápido|ya|pronto)\b/.test(t)) tone = 'urgency';
  else if (/\b(caro|carísimo|presupuesto bajo|no alcanza)\b/.test(t)) tone = 'price_objection';
  else if (/\b(no entiendo|confund|perdido)\b/.test(t)) tone = 'confusion';

  if (tone !== 'neutral' && !reply.includes(EMPATHY_LINES[tone]?.slice(0, 12))) {
    const empathy = EMPATHY_LINES[tone];
    if (empathy && reply.length < 220) {
      reply = `${empathy} ${reply}`;
    }
  }

  if (
    tone === 'neutral' &&
    state.conversationGoalLocked &&
    !/^perfecto|^claro|^entiendo|^gracias/i.test(reply) &&
    reply.length < 180 &&
    reply.length % 3 === 0
  ) {
    const prefix = RAPPORT_PREFIXES[reply.length % RAPPORT_PREFIXES.length];
    reply = `${prefix}${reply.charAt(0).toLowerCase()}${reply.slice(1)}`;
  }

  if (/\b(negoci|mejor precio|rebaja|descuento)\b/.test(t) && !/\b(asesor|visita|opciones)\b/i.test(reply)) {
    reply = `${reply} Si quieres, un asesor puede revisar alternativas contigo.`;
  }

  return reply.trim();
}

/**
 * @param {object} state
 * @param {string} text
 */
function detectHumanityTone(state, text) {
  const fr = detectFrustration(String(text || ''));
  if (fr.isFrustrated) return 'frustration';
  const t = normalizeText(text);
  if (/\b(urgente|rapido|rápido)\b/.test(t)) return 'urgency';
  if (/\b(caro|presupuesto|no alcanza)\b/.test(t)) return 'price_objection';
  if (/\b(no entiendo|no entiendes|que necesitan|qué necesitan|confund|perdido)\b/.test(t)) {
    return 'confusion';
  }
  if (state.advisorContactConsent === 'ACCEPTED') return 'closing';
  return 'neutral';
}

module.exports = {
  applyHumanityWave2Reply,
  detectHumanityTone,
};
