'use strict';

const { normalizeText } = require('../utils/text');
const { buildFinalHandoffReply } = require('./responseBuilder');
const {
  buildOperationalHandoffSummary,
  buildStandardHandoffStatePatch,
  resolvePostHandoffTurn,
} = require('./cuarzoHandoff');

/** Solo petición explícita de asesor/persona — no visita ni interés comercial genérico. */
function isExplicitHumanAdvisorRequest(text = '', parsedSignals = {}) {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  if (
    t.includes('asesor') ||
    t.includes('agente') ||
    t.includes('humano') ||
    t.includes('persona real') ||
    t.includes('hablar con alguien') ||
    t.includes('me atienda') ||
    t.includes('llamen') ||
    t.includes('marquen') ||
    t.includes('contacten')
  ) {
    return true;
  }
  return parsedSignals.explicit_human_request === true;
}

/**
 * Escalación automática cuando el usuario pide asesor humano (Cuarzo V1).
 */
function resolveWantsHumanEscalationTurn({
  previousAiState = {},
  nextAiState = {},
  parsedSignals = {},
  text = '',
} = {}) {
  const postHandoff = resolvePostHandoffTurn({ previousAiState, nextAiState, text });
  if (postHandoff.handled) {
    return {
      handled: true,
      reply: postHandoff.reply,
      statePatch: postHandoff.statePatch,
      responseSource: postHandoff.responseSource,
    };
  }

  const explicit = isExplicitHumanAdvisorRequest(text, parsedSignals);
  if (!explicit) {
    return { handled: false };
  }

  if (nextAiState.handoff_sent || previousAiState.handoff_sent) {
    return { handled: false };
  }

  const merged = {
    ...previousAiState,
    ...nextAiState,
    wants_human: true,
  };

  const summary = buildOperationalHandoffSummary(merged, {
    reason: 'explicit_human_request',
    userSnippet: String(text || '').trim(),
  });

  return {
    handled: true,
    reply: buildFinalHandoffReply(merged),
    statePatch: buildStandardHandoffStatePatch(summary, {
      last_change_type: 'wants_human_auto_escalation',
    }),
    responseSource: 'wants_human_auto_escalation',
  };
}

module.exports = {
  resolveWantsHumanEscalationTurn,
  isExplicitHumanAdvisorRequest,
};
