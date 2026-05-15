'use strict';

const { CONVERSATION_STAGES, IDENTITY_STATES, CONVERSATION_MODE, FRUSTRATION_STATES } = require('./constants');

/**
 * @typedef {object} ActiveProperty
 * @property {string|null} id
 * @property {string|null} listingCode
 */

/**
 * @typedef {object} ConversationState
 * @property {string|null} conversationId
 * @property {string|null} phone
 * @property {'offer'|'demand'|null} leadFlow
 * @property {'sale'|'rent'|null} operationType
 * @property {string} conversationStage
 * @property {string} identityState
 * @property {ActiveProperty|null} activeProperty
 * @property {string|null} locationText
 * @property {number|null} expectedPrice
 * @property {number|null} budget
 * @property {string|null} awaitingField
 * @property {string} frustrationState
 * @property {string} mode
 * @property {Record<string, unknown>} collectedFields
 * @property {string|null} lastAssistantQuestion
 * @property {{ createdAt: string, updatedAt: string }} timestamps
 * @property {boolean} hasContact
 */

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {{ conversationId?: string|null, phone?: string|null }} seed
 * @returns {ConversationState}
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
    activeProperty: null,
    locationText: null,
    expectedPrice: null,
    budget: null,
    awaitingField: null,
    frustrationState: FRUSTRATION_STATES.NONE,
    mode: CONVERSATION_MODE.AI,
    collectedFields: {},
    lastAssistantQuestion: null,
    timestamps: { createdAt: ts, updatedAt: ts },
    hasContact: false,
  };
}

/**
 * @param {ConversationState} base
 * @param {Partial<ConversationState>} patch
 * @returns {ConversationState}
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
