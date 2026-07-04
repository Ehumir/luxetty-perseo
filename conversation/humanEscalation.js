'use strict';

const { normalizeText } = require('../utils/text');
const { buildFinalHandoffReply } = require('./responseBuilder');
const {
  buildOperationalHandoffSummary,
  buildStandardHandoffStatePatch,
  resolvePostHandoffTurn,
} = require('./cuarzoHandoff');
const conversationMode = require('./conversationMode');

/** Solo petición explícita de asesor/persona — no visita ni interés comercial genérico. */
function isExplicitHumanAdvisorRequest(text = '', parsedSignals = {}) {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  if (
    t.includes('asesor') ||
    t.includes('asesor personal') ||
    t.includes('agente') ||
    t.includes('humano') ||
    t.includes('persona real') ||
    t.includes('quiero persona') ||
    t.includes('quiero una persona') ||
    t.includes('hablar con alguien') ||
    t.includes('me atienda') ||
    t.includes('llamen') ||
    t.includes('marquen') ||
    t.includes('contacten') ||
    t.includes('no maquina') ||
    t.includes('no máquina') ||
    t.includes('no bot') ||
    t.includes('no robot') ||
    t.includes('nada de bot') ||
    t.includes('nada de maquina') ||
    t.includes('nada de máquina')
  ) {
    return true;
  }
  return parsedSignals.explicit_human_request === true;
}

function isBotRejectionText(text = '') {
  const t = normalizeText(String(text || ''));
  return (
    t.includes('no maquina') ||
    t.includes('no máquina') ||
    t.includes('no bot') ||
    t.includes('no robot') ||
    t.includes('nada de bot') ||
    t.includes('nada de maquina') ||
    t.includes('nada de máquina')
  );
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
      skipSend: postHandoff.skipSend === true,
      statePatch: {
        ...postHandoff.statePatch,
        ...conversationMode.patchForHumanHandoffSent(postHandoff.statePatch || {}),
      },
      responseSource: postHandoff.responseSource,
      reason: postHandoff.reason || 'post_handoff',
    };
  }

  const explicit = isExplicitHumanAdvisorRequest(text, parsedSignals);
  if (!explicit) {
    return { handled: false };
  }

  if (nextAiState.handoff_sent || previousAiState.handoff_sent) {
    // Ya en handoff: silencio si insiste en humano/bot
    return {
      handled: true,
      reply: null,
      skipSend: true,
      statePatch: conversationMode.patchForHumanHandoffSent({
        post_handoff_hold_sent: true,
      }),
      responseSource: 'human_mode_silence',
      reason: 'already_handed_off',
    };
  }

  const merged = {
    ...previousAiState,
    ...nextAiState,
    wants_human: true,
  };

  const summary = buildOperationalHandoffSummary(merged, {
    reason: isBotRejectionText(text) ? 'bot_rejection' : 'explicit_human_request',
    userSnippet: String(text || '').trim(),
  });

  return {
    handled: true,
    reply: buildFinalHandoffReply(merged),
    statePatch: {
      ...buildStandardHandoffStatePatch(summary, {
        last_change_type: 'wants_human_auto_escalation',
      }),
      ...conversationMode.patchForHumanHandoffSent({
        handoff_reason: isBotRejectionText(text) ? 'bot_rejection' : 'explicit_human_request',
      }),
    },
    responseSource: 'wants_human_auto_escalation',
    reason: isBotRejectionText(text) ? 'bot_rejection' : 'explicit_human_request',
  };
}

module.exports = {
  resolveWantsHumanEscalationTurn,
  isExplicitHumanAdvisorRequest,
  isBotRejectionText,
};
