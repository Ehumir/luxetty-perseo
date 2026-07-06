'use strict';

const {
  CONVERSATION_STAGES,
  IDENTITY_STATES,
  CONVERSATION_MODE,
  FRUSTRATION_STATES,
  ADVISOR_CONTACT_CONSENT,
} = require('./constants');

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {{ conversationId?: string|null, phone?: string|null }} seed
 */
function createInitialConversationState(seed = {}) {
  const ts = nowIso();
  return {
    conversationId: seed.conversationId != null ? String(seed.conversationId) : null,
    phone: seed.phone != null ? String(seed.phone) : null,
    leadFlow: null,
    operationType: null,
    conversationStage: CONVERSATION_STAGES.NEW,
    identityState: IDENTITY_STATES.UNKNOWN,
    conversationGoal: null,
    conversationGoalLocked: false,
    goalConfidence: 0,
    activeProperty: null,
    locationText: null,
    propertyType: null,
    occupancyStatus: null,
    expectedPrice: null,
    /** F4.1 — venta sin precio conocido; pide valuación */
    priceUnknown: false,
    valuationRequested: false,
    budget: null,
    bedrooms: null,
    /** @type {'credit'|'cash'|'unknown'|null} */
    paymentMethod: null,
    awaitingField: null,
    /** Último slot preguntado explícitamente (prioridad interpretación M1-PR-04). */
    lastAskedField: null,
    advisorContactConsent: ADVISOR_CONTACT_CONSENT.UNKNOWN,
    qualificationComplete: false,
    crmPayloadReady: false,
    crmPayloadPreview: null,
    /** F6 — ejecución CRM real (allowlist + flag) */
    crmExecutionCompleted: false,
    crmExecutionStatus: null,
    crmContactId: null,
    crmLeadId: null,
    crmExecutedAt: null,
    crmExecutionError: null,
    qualificationMissingSlots: [],
    handoffStage: null,
    frustrationState: FRUSTRATION_STATES.NONE,
    mode: CONVERSATION_MODE.AI,
    collectedFields: {},
    lastAssistantQuestion: null,
    lastAssistantReply: null,
    lastUserText: null,
    timestamps: { createdAt: ts, updatedAt: ts },
    hasContact: false,
    propertyListingCode: null,
    propertySpecificIntent: false,
    campaignHeadline: null,
    channelPreference: null,
    /** @type {'PROPERTY_QA'|'HANDOFF_OFFERED'|null} */
    propertySubMode: null,
    propertyQaUserTurnCount: 0,
    propertyQaAnswerCount: 0,
    /** @type {string|null} */
    lastComposerIntent: null,
    /** @type {'HANDOFF_PROPERTY'|'FACT'|null} */
    lastOfferType: null,
    loopRiskScore: 0,
    /** @type {string|null} */
    lastAnsweredPropertyFamily: null,
    /** F3.3B — razón de escalada / fallback forzado */
    unhandledReason: null,
    handoffReason: null,
    unknownIntentStreak: 0,
    /** M1 — firma normalizada del último reply (anti-repetición). */
    lastAssistantReplySignature: null,
    /** Saludos consecutivos sin goal (familia CHAOS vs REG). */
    consecutiveGreetingTurns: 0,
    /** Ancla sticky — no degradar por mensajes ambiguos posteriores. */
    stickyConversationGoal: null,
    stickyLeadFlow: null,
    stickyOperationType: null,
    /** M1-D — historial de códigos consultados (más reciente primero). */
    propertyHistory: [],
    /** M2 — última decisión PolicyEngine (ARGOS trace / snapshot). */
    lastPolicyDecision: null,
    lastPolicyRuleId: null,
    lastSegments: null,
    lastResponsePlan: null,
    /** Sprint 4 — ContextPack RAG interno (no mostrar al usuario). */
    ragContextPack: null,
  };
}

/**
 * @param {import('./conversationState').ConversationState} base
 * @param {Partial<import('./conversationState').ConversationState>} patch
 */
function mergeConversationState(base, patch) {
  const ts = nowIso();
  const next = {
    ...base,
    ...patch,
    collectedFields:
      patch.collectedFields && typeof patch.collectedFields === 'object'
        ? { ...base.collectedFields, ...patch.collectedFields }
        : { ...base.collectedFields },
    activeProperty:
      patch.activeProperty === undefined
        ? base.activeProperty
        : patch.activeProperty === null
          ? null
          : { ...(base.activeProperty || {}), ...patch.activeProperty },
    timestamps: {
      createdAt: base.timestamps.createdAt,
      updatedAt: ts,
    },
  };
  return next;
}

module.exports = {
  createInitialConversationState,
  mergeConversationState,
};
