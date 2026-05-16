'use strict';

const { cleanSpaces, normalizeText } = require('../../../utils/text');
const { FORBIDDEN_COMPOSER_PATTERNS } = require('../types/constants');
const { HUMAN_ESCALATION_REASONS, FORCED_HANDOFF_REASONS } = require('../types/forcedHandoffReasons');
const { ADVISOR_CONTACT_CONSENT } = require('../types/constants');
const { isBotIdentityQuestion } = require('../interpreter/objectionClassifier');
const { firstName } = require('./postHandoffComposer');

function assertForcedHandoffQuality(text) {
  const s = String(text || '');
  for (const p of FORBIDDEN_COMPOSER_PATTERNS) {
    if (p.test(s)) return false;
  }
  if (!/\b(asesor|asesora)\b/i.test(s)) return false;
  if (!/\b(canalizar|canalizaci[oó]n)\b/i.test(s)) return false;
  if (!/\b(contactar[aá]|contactar[aá]n|escribir[aá]|seguimiento|whatsapp)\b/i.test(s)) return false;
  return s.trim().length > 0;
}

function buildCanalizationCore(nm) {
  const greet = nm ? `Entiendo, ${nm}.` : 'Entiendo.';
  return `${greet} Para ayudarte bien con esto, voy a canalizar tu caso con un asesor de Luxetty. En breve te contactará por WhatsApp para continuar contigo y afinar los detalles.`;
}

/**
 * @param {string} reason
 * @param {string|null} nm
 * @param {string} [userText]
 */
function buildReasonLead(reason, nm, userText = '') {
  const greet = nm ? `Entiendo, ${nm}.` : 'Entiendo.';

  if (reason === FORCED_HANDOFF_REASONS.USER_REQUESTS_HUMAN && isBotIdentityQuestion(userText)) {
    return `${greet} Soy el asesor IA de Luxetty: te oriento y reúno datos básicos; si necesitas criterio humano, también te canalizo con el equipo.`;
  }

  switch (reason) {
    case FORCED_HANDOFF_REASONS.MEDIA_UNSUPPORTED:
      return `${greet} Por aquí no puedo procesar audio, imagen o documento con el detalle que merece tu caso.`;
    case FORCED_HANDOFF_REASONS.LEGAL_ESCALATION:
      return `${greet} Este tema requiere criterio legal y humano especializado; no puedo cerrarlo solo por chat.`;
    case FORCED_HANDOFF_REASONS.FRUSTRATION_HIGH:
      return `${greet} Lamento la confusión y el malentendido.`;
    case FORCED_HANDOFF_REASONS.LOOP_EXHAUSTED:
      return `${greet} Para no darte más vueltas con lo mismo,`;
    case FORCED_HANDOFF_REASONS.RULE_GUARD_VIOLATION:
      return `${greet} Para no asumir datos que no puedo confirmar por aquí,`;
    case FORCED_HANDOFF_REASONS.RUNTIME_ERROR:
      return `${greet} Tuve un inconveniente técnico al procesar tu mensaje;`;
    case FORCED_HANDOFF_REASONS.OUT_OF_CATALOG:
      return `${greet} Este caso queda fuera de lo que puedo resolver solo por aquí,`;
    case FORCED_HANDOFF_REASONS.INTENT_UNKNOWN:
      return `${greet} No alcancé a ubicar bien tu solicitud en este hilo,`;
    case FORCED_HANDOFF_REASONS.USER_REQUESTS_HUMAN:
      return `${greet} Con gusto te pongo en contacto con el equipo humano.`;
    default:
      if (HUMAN_ESCALATION_REASONS.has(reason)) {
        return `${greet} Lamento la confusión.`;
      }
      return greet;
  }
}

/**
 * @param {string} reason
 */
function buildReasonTail(reason) {
  if (reason === FORCED_HANDOFF_REASONS.LOOP_EXHAUSTED) {
    return ' voy a canalizar tu caso con un asesor de Luxetty. En breve te contactará por WhatsApp para seguir contigo.';
  }
  if (reason === FORCED_HANDOFF_REASONS.RULE_GUARD_VIOLATION) {
    return ' voy a canalizar tu caso con un asesor de Luxetty. En breve te contactará por WhatsApp para validar contigo.';
  }
  if (reason === FORCED_HANDOFF_REASONS.RUNTIME_ERROR) {
    return ' voy a canalizar tu caso con un asesor de Luxetty. En breve te contactará por WhatsApp para darte seguimiento.';
  }
  if (reason === FORCED_HANDOFF_REASONS.OUT_OF_CATALOG || reason === FORCED_HANDOFF_REASONS.INTENT_UNKNOWN) {
    return ' voy a canalizar tu caso con un asesor de Luxetty. En breve te contactará por WhatsApp para orientarte.';
  }
  return ' Para ayudarte bien con esto, voy a canalizar tu caso con un asesor de Luxetty. En breve te contactará por WhatsApp para continuar contigo y afinar los detalles.';
}

/**
 * Copy obligatorio F3.3B / F4 — reconocimiento + canalización + contacto WhatsApp.
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} reason
 * @param {{ userText?: string }} [opts]
 */
function composeForcedHandoffFallback(state, reason, opts = {}) {
  const nm = firstName(state);
  const userText = opts.userText != null ? String(opts.userText) : String(state.lastUserText || '');
  const lead = buildReasonLead(reason, nm, userText);
  const tail = buildReasonTail(reason);
  let body = `${lead}${lead.endsWith('.') ? ' ' : ''}${tail}`.replace(/\s+/g, ' ').trim();

  if (!lead.includes('canalizar') && !tail.includes('canalizar')) {
    body = buildCanalizationCore(nm);
    if (reason === FORCED_HANDOFF_REASONS.MEDIA_UNSUPPORTED) {
      body = `${nm ? `Entiendo, ${nm}.` : 'Entiendo.'} Por aquí no puedo procesar ese tipo de mensaje con detalle. ${body.replace(/^Entiendo[^.]*\.\s*/i, '')}`;
    }
  }

  let awaitingField = null;
  const consent = state.advisorContactConsent;

  if (
    consent !== ADVISOR_CONTACT_CONSENT.ACCEPTED &&
    reason !== 'runtime_error'
  ) {
    if (reason !== FORCED_HANDOFF_REASONS.USER_REQUESTS_HUMAN || !isBotIdentityQuestion(userText)) {
      body = `${body} ¿Está bien si te contactan por este mismo número?`;
    }
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
  buildCanalizationCore,
};
