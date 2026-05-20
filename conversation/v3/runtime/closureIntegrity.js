'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');
const { parseMoneyAmount } = require('../interpreter/moneyParser');
const { normalizeLocationFromUserText } = require('../interpreter/locationNormalizer');
const {
  isShortPostCloseAck,
  isPositiveHandoffAck,
} = require('../interpreter/objectionClassifier');
const { parseAdvisorContactConsent } = require('../planner/consentParser');
const { ADVISOR_CONTACT_CONSENT, CONVERSATION_STAGES } = require('../types/constants');

function nowIso() {
  return new Date().toISOString();
}

function firstName(state) {
  const full = cleanSpaces(String(state?.collectedFields?.fullName || ''));
  if (!full) return null;
  return full.split(/\s+/)[0];
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

function isClosureGateActive(ctx) {
  return ctx.handoffWaitingFinalConfirmation === true || ctx.conversationSoftClosed === true;
}

function isExplicitCommercialReopen(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  if (isShortPostCloseAck(text) && t.length < 24) return false;
  if (
    /\b(busco|quiero|necesito|me interesa|tambien|también|revisar|ver opciones|comprar|rentar|vender|presupuesto|recamaras|recámaras)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (normalizeLocationFromUserText(text)) return true;
  if (parseMoneyAmount(text) != null) return true;
  if (/\bgarcia|garcía|cumbres|san pedro|monterrey\b/i.test(t) && t.length > 8) return true;
  return false;
}

function isFinalCloseAck(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  if (/^(?:no\s+gracias|no\s+gracias\s+nada|no\s+nada|no\s+por\s+ahora|no\s+gracias\s+por\s+ahora)$/i.test(t)) {
    return true;
  }
  if (isShortPostCloseAck(text)) return true;
  if (/^(?:no|nada|nada\s+mas|nada\s+más|estoy\s+bien|todo\s+bien|ya\s+esta|ya\s+está)$/i.test(t)) {
    return true;
  }
  return false;
}

function buildConsentAcceptedClosurePatch() {
  const ts = nowIso();
  return {
    handoffCompletedAt: ts,
    handoffWaitingFinalConfirmation: true,
    conversationSoftClosed: false,
    lastHandoffPromptAt: ts,
    explicitReopen: false,
    advisorContactConsent: ADVISOR_CONTACT_CONSENT.ACCEPTED,
    handoffStage: CONVERSATION_STAGES.HANDOFF_READY,
    conversationStage: CONVERSATION_STAGES.HANDOFF_READY,
    awaitingField: null,
    lastAskedField: null,
  };
}

function buildSoftClosePatch() {
  return {
    handoffWaitingFinalConfirmation: false,
    conversationSoftClosed: true,
    explicitReopen: false,
    awaitingField: null,
    lastAskedField: null,
  };
}

function buildExplicitReopenPatch() {
  return {
    handoffWaitingFinalConfirmation: false,
    conversationSoftClosed: false,
    explicitReopen: true,
    awaitingField: null,
  };
}

function composeConsentAcceptedMessage(state) {
  const nm = firstName(state) || 'perfecto';
  return `Perfecto, ${nm}. Ya dejé anotado que un asesor de Luxetty te contacte por este mismo medio.\n\nAntes de cerrar por ahora, ¿hay algo más en lo que te pueda ayudar?`;
}

function composeSoftCloseFinalMessage(state) {
  return 'Con gusto. Si más adelante necesitas revisar opciones o apoyo con alguna propiedad, aquí estaré para ayudarte.';
}

function composeExplicitReopenMessage(state, text) {
  const zone = normalizeLocationFromUserText(text) || state.locationText || 'esa zona';
  const nm = firstName(state);
  const head = nm ? `Claro, ${nm}, retomamos.` : 'Claro, retomamos.';
  return `${head} Revisamos ${zone}. ¿Buscas comprar o rentar?`;
}

function composeWaitingMoreHelpReminder(state) {
  const nm = firstName(state) || 'perfecto';
  return `${nm}, sin problema. ¿Hay algo más en lo que te pueda ayudar antes de cerrar por ahora?`;
}

/**
 * @param {{ state: object, text: string }} input
 * @returns {{ handled: boolean, reply?: string|string[], statePatch?: object, responseSource?: string }}
 */
function tryResolveClosureIntegrityTurn(input) {
  const state = input.state || {};
  const text = String(input.text || '');
  const ctx = fromV3State(state);

  if (!isClosureGateActive(ctx)) {
    if (parseAdvisorContactConsent(text) === 'ACCEPTED' && ctx.advisorContactConsent === ADVISOR_CONTACT_CONSENT.REQUESTED) {
      return null;
    }
    return null;
  }

  if (isExplicitCommercialReopen(text)) {
    return {
      handled: true,
      reply: composeExplicitReopenMessage(state, text),
      statePatch: buildExplicitReopenPatch(),
      responseSource: 'v3_closure_reopen',
    };
  }

  if (ctx.handoffWaitingFinalConfirmation && !ctx.conversationSoftClosed) {
    if (isFinalCloseAck(text)) {
      return {
        handled: true,
        reply: composeSoftCloseFinalMessage(state),
        statePatch: buildSoftClosePatch(),
        responseSource: 'v3_closure_soft_close',
      };
    }
    if (!isPositiveHandoffAck(text)) {
      return {
        handled: true,
        reply: composeWaitingMoreHelpReminder(state),
        statePatch: {},
        responseSource: 'v3_closure_waiting_confirm',
      };
    }
  }

  if (ctx.conversationSoftClosed) {
    if (isFinalCloseAck(text)) {
      return {
        handled: true,
        reply: composeSoftCloseFinalMessage(state),
        statePatch: {},
        responseSource: 'v3_closure_soft_close_ack',
      };
    }
    return {
      handled: true,
      reply: composeSoftCloseFinalMessage(state),
      statePatch: {},
      responseSource: 'v3_closure_soft_closed_hold',
    };
  }

  return null;
}

function shouldBlockCommercialPipeline(ctx) {
  return isClosureGateActive(ctx);
}

function isLegacySearchReopenReply(text) {
  const t = normalizeText(String(text || ''));
  return (
    /\bseguimos con tu b[uú]squeda\b/i.test(t) ||
    /\bafinar\s+(?:rec[aá]maras|presupuesto|zona)\b/i.test(t) ||
    /\bme confirmas tu presupuesto\b/i.test(t) ||
    /\bcompra o renta\b/i.test(t) && /\bseguimos\b/i.test(t)
  );
}

/**
 * Legacy path guard when V3 primary did not handle the turn.
 */
function resolveLegacyClosureTurn({ text, previousAiState, nextAiState }) {
  const ctx = {
    ...fromLegacyAiState(previousAiState),
    ...fromLegacyAiState(nextAiState),
  };

  if (!isClosureGateActive(ctx)) return null;

  const v3ish = {
    collectedFields: { fullName: nextAiState?.full_name || previousAiState?.full_name || null },
    locationText: nextAiState?.location_text || previousAiState?.location_text || null,
  };

  if (isExplicitCommercialReopen(text)) {
    const patch = {
      conversation_soft_closed: false,
      handoff_waiting_final_confirmation: false,
      explicit_reopen: true,
      awaiting_field: null,
    };
    return {
      handled: true,
      reply: [composeExplicitReopenMessage(v3ish, text)],
      statePatch: patch,
      responseSource: 'closure_integrity_reopen',
    };
  }

  if (isFinalCloseAck(text) || isShortPostCloseAck(text)) {
    const patch = {
      conversation_soft_closed: true,
      handoff_waiting_final_confirmation: false,
      awaiting_field: null,
    };
    return {
      handled: true,
      reply: [composeSoftCloseFinalMessage(v3ish)],
      statePatch: patch,
      responseSource: 'closure_integrity_soft_close',
    };
  }

  if (ctx.handoffWaitingFinalConfirmation) {
    return {
      handled: true,
      reply: [composeWaitingMoreHelpReminder(v3ish)],
      statePatch: {},
      responseSource: 'closure_integrity_waiting',
    };
  }

  return {
    handled: true,
    reply: [composeSoftCloseFinalMessage(v3ish)],
    statePatch: { conversation_soft_closed: true, handoff_waiting_final_confirmation: false },
    responseSource: 'closure_integrity_hold',
  };
}

function shouldBlockLegacyCommercialReply(aiState) {
  return shouldBlockCommercialPipeline(fromLegacyAiState(aiState));
}

function mapClosurePatchToLegacy(patch) {
  const p = patch || {};
  return {
    handoff_completed_at: p.handoffCompletedAt || nowIso(),
    handoff_waiting_final_confirmation: p.handoffWaitingFinalConfirmation === true,
    conversation_soft_closed: p.conversationSoftClosed === true,
    last_handoff_prompt_at: p.lastHandoffPromptAt || nowIso(),
    explicit_reopen: p.explicitReopen === true,
    advisor_contact_consent: p.advisorContactConsent || 'ACCEPTED',
    awaiting_field: null,
    last_asked_field: null,
  };
}

function tryResolveLegacyConsentClosure({ text, previousAiState, nextAiState }) {
  const { parseAdvisorContactConsent } = require('../planner/consentParser');
  if (parseAdvisorContactConsent(text) !== 'ACCEPTED') return null;
  const prev = previousAiState && typeof previousAiState === 'object' ? previousAiState : {};
  const next = nextAiState && typeof nextAiState === 'object' ? nextAiState : {};
  const awaiting =
    next.awaiting_field === 'advisor_contact_consent' || prev.awaiting_field === 'advisor_contact_consent';
  const requested =
    prev.advisor_contact_consent === 'REQUESTED' || next.advisor_contact_consent === 'REQUESTED';
  if (!awaiting && !requested) return null;
  const v3ish = {
    collectedFields: { fullName: next.full_name || prev.full_name || null },
    locationText: next.location_text || prev.location_text || null,
  };
  return {
    handled: true,
    reply: [composeConsentAcceptedMessage(v3ish)],
    statePatch: mapClosurePatchToLegacy(buildConsentAcceptedClosurePatch()),
    responseSource: 'closure_integrity_legacy_consent',
  };
}

module.exports = {
  nowIso,
  isClosureGateActive,
  isExplicitCommercialReopen,
  isFinalCloseAck,
  buildConsentAcceptedClosurePatch,
  buildSoftClosePatch,
  buildExplicitReopenPatch,
  composeConsentAcceptedMessage,
  composeSoftCloseFinalMessage,
  composeExplicitReopenMessage,
  tryResolveClosureIntegrityTurn,
  shouldBlockCommercialPipeline,
  shouldBlockLegacyCommercialReply,
  resolveLegacyClosureTurn,
  isLegacySearchReopenReply,
  fromV3State,
  fromLegacyAiState,
  mapClosurePatchToLegacy,
  tryResolveLegacyConsentClosure,
};
