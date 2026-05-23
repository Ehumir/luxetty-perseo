'use strict';

const { normalizeText } = require('../utils/text');
const { buildFinalHandoffReply } = require('./responseBuilder');

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
    t.includes('llamen') ||
    t.includes('marquen') ||
    t.includes('contacten')
  ) {
    return true;
  }
  return parsedSignals.explicit_human_request === true;
}

/**
 * Escalación automática cuando el usuario pide asesor humano (Cuarzo 0C).
 */
function resolveWantsHumanEscalationTurn({
  previousAiState = {},
  nextAiState = {},
  parsedSignals = {},
  text = '',
} = {}) {
  const explicit = isExplicitHumanAdvisorRequest(text, parsedSignals);
  const sticky =
    explicit &&
    (!!parsedSignals.wants_human || !!nextAiState.wants_human || !!previousAiState.wants_human);

  if (!sticky) {
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

  return {
    handled: true,
    reply: buildFinalHandoffReply(merged),
    statePatch: {
      wants_human: true,
      handoff_ready: true,
      handoff_sent: true,
      awaiting_field: null,
      pending_name_capture: false,
      last_change_type: 'wants_human_auto_escalation',
    },
    responseSource: 'wants_human_auto_escalation',
  };
}

module.exports = {
  resolveWantsHumanEscalationTurn,
  isExplicitHumanAdvisorRequest,
};
