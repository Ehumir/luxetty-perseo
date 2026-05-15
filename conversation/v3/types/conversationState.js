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
    budget: null,
    bedrooms: null,
    awaitingField: null,
    advisorContactConsent: ADVISOR_CONTACT_CONSENT.UNKNOWN,
    qualificationComplete: false,
    crmPayloadReady: false,
    crmPayloadPreview: null,
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
