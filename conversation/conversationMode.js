'use strict';

/**
 * conversation_mode: AI | MIXED | HUMAN_WAITING | HUMAN | AI_REACTIVATED
 * Gate superior: en HUMAN* no corre advisor ni fallback comercial.
 */

const CONVERSATION_MODES = Object.freeze({
  AI: 'AI',
  MIXED: 'MIXED',
  HUMAN_WAITING: 'HUMAN_WAITING',
  HUMAN: 'HUMAN',
  AI_REACTIVATED: 'AI_REACTIVATED',
});

const HUMAN_BLOCKED_MODES = new Set([
  CONVERSATION_MODES.HUMAN,
  CONVERSATION_MODES.HUMAN_WAITING,
  CONVERSATION_MODES.MIXED,
]);

function normalizeConversationMode(value) {
  const v = String(value || '').trim().toUpperCase();
  if (Object.values(CONVERSATION_MODES).includes(v)) return v;
  return CONVERSATION_MODES.AI;
}

function getConversationMode(aiState = {}) {
  const st = aiState && typeof aiState === 'object' ? aiState : {};
  if (st.conversation_mode) return normalizeConversationMode(st.conversation_mode);
  if (st.handoff_sent || st.wants_human) {
    return st.terminal_ack_close || st.post_handoff_hold_sent
      ? CONVERSATION_MODES.HUMAN
      : CONVERSATION_MODES.HUMAN_WAITING;
  }
  return CONVERSATION_MODES.AI;
}

function isHumanModeBlocked(aiState = {}) {
  return HUMAN_BLOCKED_MODES.has(getConversationMode(aiState));
}

/**
 * @returns {{ blocked: boolean, reason: string|null, statePatch: object }}
 */
function evaluateConversationModeGate({ previousAiState = {}, nextAiState = {}, text = '' } = {}) {
  let reopen = false;
  try {
    const { shouldExplicitlyReopenConversation } = require('./conversationReopenPolicy');
    reopen = shouldExplicitlyReopenConversation(text, { ...previousAiState, ...nextAiState });
  } catch {
    reopen = false;
  }

  const merged = { ...previousAiState, ...nextAiState };
  const mode = getConversationMode(merged);

  if (reopen && isHumanModeBlocked(merged)) {
    return {
      blocked: false,
      reason: null,
      statePatch: {
        conversation_mode: CONVERSATION_MODES.AI_REACTIVATED,
        handoff_sent: false,
        wants_human: false,
        post_handoff_hold_sent: false,
        terminal_ack_close: false,
      },
    };
  }

  if (!isHumanModeBlocked(merged)) {
    return { blocked: false, reason: null, statePatch: { conversation_mode: mode || CONVERSATION_MODES.AI } };
  }

  return {
    blocked: true,
    reason: `conversation_mode_${mode}`,
    statePatch: {
      conversation_mode: mode,
      awaiting_field: null,
    },
  };
}

function patchForHumanRequest(extra = {}) {
  return {
    conversation_mode: CONVERSATION_MODES.HUMAN_WAITING,
    wants_human: true,
    ...extra,
  };
}

function patchForHumanHandoffSent(extra = {}) {
  return {
    conversation_mode: CONVERSATION_MODES.HUMAN,
    wants_human: true,
    handoff_sent: true,
    handoff_ready: true,
    ...extra,
  };
}

function patchForMixedThread(extra = {}) {
  return {
    conversation_mode: CONVERSATION_MODES.MIXED,
    ...extra,
  };
}

module.exports = {
  CONVERSATION_MODES,
  HUMAN_BLOCKED_MODES,
  normalizeConversationMode,
  getConversationMode,
  isHumanModeBlocked,
  evaluateConversationModeGate,
  patchForHumanRequest,
  patchForHumanHandoffSent,
  patchForMixedThread,
};
