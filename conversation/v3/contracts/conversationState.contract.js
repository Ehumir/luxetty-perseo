'use strict';

const {
  CONVERSATION_STAGES,
  IDENTITY_STATES,
  CONVERSATION_MODE,
  FRUSTRATION_STATES,
  ADVISOR_CONTACT_CONSENT,
  CONVERSATION_GOALS,
  PROPERTY_SUB_MODE,
} = require('../types/constants');
const { createInitialConversationState } = require('../types/conversationState');
const { isPlainObject, isFiniteNumber, pushError, result } = require('./_helpers');

const STAGES = new Set(Object.values(CONVERSATION_STAGES));
const IDENTITY = new Set(Object.values(IDENTITY_STATES));
const MODES = new Set(Object.values(CONVERSATION_MODE));
const FRUSTRATION = new Set(Object.values(FRUSTRATION_STATES));
const CONSENT = new Set(Object.values(ADVISOR_CONTACT_CONSENT));
const GOALS = new Set(Object.values(CONVERSATION_GOALS));
const SUB_MODES = new Set(Object.values(PROPERTY_SUB_MODE));

/**
 * Valida forma mínima de ConversationState (contrato F1).
 * @param {unknown} state
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConversationState(state) {
  const errors = [];
  if (!isPlainObject(state)) {
    pushError(errors, 'state_not_object');
    return result(errors);
  }

  if (!STAGES.has(state.conversationStage)) {
    pushError(errors, 'invalid_conversation_stage', String(state.conversationStage));
  }
  if (!IDENTITY.has(state.identityState)) {
    pushError(errors, 'invalid_identity_state', String(state.identityState));
  }
  if (!MODES.has(state.mode)) {
    pushError(errors, 'invalid_mode', String(state.mode));
  }
  if (!FRUSTRATION.has(state.frustrationState)) {
    pushError(errors, 'invalid_frustration_state', String(state.frustrationState));
  }
  if (!CONSENT.has(state.advisorContactConsent)) {
    pushError(errors, 'invalid_advisor_consent', String(state.advisorContactConsent));
  }
  if (state.conversationGoal != null && !GOALS.has(state.conversationGoal)) {
    pushError(errors, 'invalid_conversation_goal', String(state.conversationGoal));
  }
  if (state.propertySubMode != null && !SUB_MODES.has(state.propertySubMode)) {
    pushError(errors, 'invalid_property_sub_mode', String(state.propertySubMode));
  }
  if (!isPlainObject(state.collectedFields)) {
    pushError(errors, 'collected_fields_not_object');
  }
  if (!isPlainObject(state.timestamps)) {
    pushError(errors, 'timestamps_not_object');
  } else {
    if (typeof state.timestamps.createdAt !== 'string' || typeof state.timestamps.updatedAt !== 'string') {
      pushError(errors, 'timestamps_iso_required');
    }
  }
  if (state.expectedPrice != null && !isFiniteNumber(state.expectedPrice)) {
    pushError(errors, 'expected_price_not_number');
  }
  if (state.budget != null && !isFiniteNumber(state.budget)) {
    pushError(errors, 'budget_not_number');
  }
  if (typeof state.conversationGoalLocked !== 'boolean') {
    pushError(errors, 'conversation_goal_locked_not_boolean');
  }
  if (typeof state.qualificationComplete !== 'boolean') {
    pushError(errors, 'qualification_complete_not_boolean');
  }

  return result(errors);
}

module.exports = {
  validateConversationState,
  createInitialConversationState,
};
