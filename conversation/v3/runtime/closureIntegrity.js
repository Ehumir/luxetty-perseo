'use strict';

const { ADVISOR_CONTACT_CONSENT, CONVERSATION_STAGES } = require('../types/constants');
const { parseAdvisorContactConsent } = require('../planner/consentParser');
const { isPositiveHandoffAck } = require('../interpreter/objectionClassifier');
const {
  isClosureGateActive,
  shouldExplicitlyReopenConversation,
  shouldTreatAsPostCloseAck,
  buildExplicitReopenStatePatch,
  buildSoftCloseStatePatch,
  buildConsentWaitingPatch,
  composeExplicitReopenReply,
  composeSoftCloseReply,
  composeWaitingMoreHelpReply,
  composeConsentAcceptedReply,
  recordConversationReopened,
  readClosureContext,
  isExplicitCommercialReopen,
} = require('../../conversationReopenPolicy');

function nowIso() {
  return new Date().toISOString();
}

function fromV3State(state) {
  if (!state || typeof state !== 'object') return {};
  return {
    handoffCompletedAt: state.handoffCompletedAt || null,
    handoffWaitingFinalConfirmation: state.handoffWaitingFinalConfirmation === true,
    conversationSoftClosed: state.conversationSoftClosed === true,
    lastHandoffPromptAt: state.lastHandoffPromptAt || null,
    explicitReopen: state.explicitReopen === true,
    advisorContactConsent: state.advisorContactConsent || null,
    collectedFields: state.collectedFields || {},
    locationText: state.locationText || null,
    conversationStage: state.conversationStage || null,
    handoffStage: state.handoffStage || null,
  };
}

function fromLegacyAiState(aiState) {
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  return {
    handoffCompletedAt: s.handoff_completed_at || null,
    handoffWaitingFinalConfirmation: s.handoff_waiting_final_confirmation === true,
    conversationSoftClosed: s.conversation_soft_closed === true,
    lastHandoffPromptAt: s.last_handoff_prompt_at || null,
    explicitReopen: s.explicit_reopen === true,
    advisorContactConsent: s.advisor_contact_consent || null,
    collectedFields: { fullName: s.full_name || null },
    locationText: s.location_text || null,
    conversationStage: s.conversation_stage || null,
    handoffStage: s.handoff_stage || null,
  };
}

function buildConsentAcceptedClosurePatch() {
  const base = buildConsentWaitingPatch(nowIso());
  return {
    ...base,
    advisorContactConsent: ADVISOR_CONTACT_CONSENT.ACCEPTED,
    handoffStage: CONVERSATION_STAGES.HANDOFF_READY,
    conversationStage: CONVERSATION_STAGES.HANDOFF_READY,
  };
}

function mapClosurePatchToLegacy(patch) {
  const p = patch || {};
  return {
    handoff_completed_at: p.handoffCompletedAt || p.handoff_completed_at || nowIso(),
    handoff_waiting_final_confirmation:
      p.handoffWaitingFinalConfirmation === true || p.handoff_waiting_final_confirmation === true,
    conversation_soft_closed: p.conversationSoftClosed === true || p.conversation_soft_closed === true,
    last_handoff_prompt_at: p.lastHandoffPromptAt || p.last_handoff_prompt_at || nowIso(),
    explicit_reopen: p.explicitReopen === true || p.explicit_reopen === true,
    advisor_contact_consent: p.advisorContactConsent || 'ACCEPTED',
    awaiting_field: null,
    last_asked_field: null,
  };
}

function mergeV3Patch(patch) {
  const p = patch || {};
  const out = {};
  const keys = [
    'handoffCompletedAt',
    'handoffWaitingFinalConfirmation',
    'conversationSoftClosed',
    'lastHandoffPromptAt',
    'explicitReopen',
    'advisorContactConsent',
    'handoffStage',
    'conversationStage',
    'awaitingField',
    'lastAskedField',
  ];
  for (const key of keys) {
    if (p[key] !== undefined) out[key] = p[key];
  }
  return out;
}

/**
 * @param {{ state: object, text: string, conversationId?: string, saveConversationEvent?: Function, pipeline?: string }} input
 */
function tryResolveClosureIntegrityTurn(input) {
  const state = input.state || {};
  const text = String(input.text || '');
  const pipeline = input.pipeline || 'v3';

  if (!isClosureGateActive(state)) return null;

  if (shouldExplicitlyReopenConversation(text, state)) {
    const patch = buildExplicitReopenStatePatch();
    void recordConversationReopened({
      conversationId: input.conversationId,
      message: text,
      previousAiState: state,
      pipeline,
      saveConversationEvent: input.saveConversationEvent,
    }).catch(() => {});
    return {
      handled: true,
      reply: composeExplicitReopenReply(state, text),
      statePatch: mergeV3Patch(patch),
      responseSource: 'v3_closure_reopen',
    };
  }

  const ctx = readClosureContext(state);

  if (ctx.handoffWaitingFinalConfirmation && !ctx.conversationSoftClosed) {
    if (shouldTreatAsPostCloseAck(text)) {
      return {
        handled: true,
        reply: composeSoftCloseReply(),
        statePatch: mergeV3Patch(buildSoftCloseStatePatch()),
        responseSource: 'v3_closure_soft_close',
      };
    }
    if (!isPositiveHandoffAck(text)) {
      return {
        handled: true,
        reply: composeWaitingMoreHelpReply(state),
        statePatch: {},
        responseSource: 'v3_closure_waiting_confirm',
      };
    }
  }

  if (ctx.conversationSoftClosed) {
    if (shouldTreatAsPostCloseAck(text)) {
      return {
        handled: true,
        reply: composeSoftCloseReply(),
        statePatch: {},
        responseSource: 'v3_closure_soft_close_ack',
      };
    }
    return {
      handled: true,
      reply: composeSoftCloseReply(),
      statePatch: {},
      responseSource: 'v3_closure_soft_closed_hold',
    };
  }

  return null;
}

function shouldBlockCommercialPipeline(ctxOrState) {
  return isClosureGateActive(ctxOrState);
}

function isLegacySearchReopenReply(text) {
  const t = require('../../../utils/text').normalizeText(String(text || ''));
  return (
    /\bseguimos con tu b[uú]squeda\b/i.test(t) ||
    /\bafinar\s+(?:rec[aá]maras|presupuesto|zona)\b/i.test(t) ||
    /\bme confirmas tu presupuesto\b/i.test(t) ||
    (/\bcompra o renta\b/i.test(t) && /\bseguimos\b/i.test(t))
  );
}

function resolveLegacyClosureTurn({ text, previousAiState, nextAiState, conversationId, saveConversationEvent }) {
  const merged = { ...previousAiState, ...nextAiState };

  if (!isClosureGateActive(merged)) return null;

  if (shouldExplicitlyReopenConversation(text, merged)) {
    const patch = buildExplicitReopenStatePatch();
    void recordConversationReopened({
      conversationId,
      message: text,
      previousAiState: merged,
      pipeline: 'fallback',
      saveConversationEvent,
    }).catch(() => {});
    return {
      handled: true,
      reply: [composeExplicitReopenReply(merged, text)],
      statePatch: patch,
      responseSource: 'closure_integrity_reopen',
    };
  }

  if (shouldTreatAsPostCloseAck(text)) {
    return {
      handled: true,
      reply: [composeSoftCloseReply()],
      statePatch: buildSoftCloseStatePatch(),
      responseSource: 'closure_integrity_soft_close',
    };
  }

  const ctx = readClosureContext(merged);
  if (ctx.handoffWaitingFinalConfirmation) {
    return {
      handled: true,
      reply: [composeWaitingMoreHelpReply(merged)],
      statePatch: {},
      responseSource: 'closure_integrity_waiting',
    };
  }

  return {
    handled: true,
    reply: [composeSoftCloseReply()],
    statePatch: buildSoftCloseStatePatch(),
    responseSource: 'closure_integrity_hold',
  };
}

function shouldBlockLegacyCommercialReply(aiState) {
  return shouldBlockCommercialPipeline(aiState);
}

function tryResolveLegacyConsentClosure({ text, previousAiState, nextAiState }) {
  if (parseAdvisorContactConsent(text) !== 'ACCEPTED') return null;
  const prev = previousAiState && typeof previousAiState === 'object' ? previousAiState : {};
  const next = nextAiState && typeof nextAiState === 'object' ? nextAiState : {};
  const awaiting =
    next.awaiting_field === 'advisor_contact_consent' || prev.awaiting_field === 'advisor_contact_consent';
  const requested =
    prev.advisor_contact_consent === 'REQUESTED' || next.advisor_contact_consent === 'REQUESTED';
  if (!awaiting && !requested) return null;
  return {
    handled: true,
    reply: [composeConsentAcceptedReply({ ...prev, ...next })],
    statePatch: mapClosurePatchToLegacy(buildConsentAcceptedClosurePatch()),
    responseSource: 'closure_integrity_legacy_consent',
  };
}

module.exports = {
  nowIso,
  isClosureGateActive,
  buildConsentAcceptedClosurePatch,
  buildSoftClosePatch: buildSoftCloseStatePatch,
  buildExplicitReopenPatch: buildExplicitReopenStatePatch,
  composeConsentAcceptedMessage: composeConsentAcceptedReply,
  composeSoftCloseFinalMessage: composeSoftCloseReply,
  composeExplicitReopenMessage: composeExplicitReopenReply,
  tryResolveClosureIntegrityTurn,
  shouldBlockCommercialPipeline,
  shouldBlockLegacyCommercialReply,
  resolveLegacyClosureTurn,
  isLegacySearchReopenReply,
  fromV3State,
  fromLegacyAiState,
  mapClosurePatchToLegacy,
  tryResolveLegacyConsentClosure,
  shouldExplicitlyReopenConversation,
  isExplicitCommercialReopen,
};
