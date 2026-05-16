'use strict';

const {
  CONVERSATION_STAGES,
  CONVERSATION_GOALS,
  V3_INTENT,
  ALL_STAGES,
} = require('../types/constants');
const { pushError, result } = require('./_helpers');

const INTENTS = new Set(Object.values(V3_INTENT));
const GOALS = new Set(Object.values(CONVERSATION_GOALS));

/**
 * @param {unknown} stage
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateStage(stage) {
  const errors = [];
  if (typeof stage !== 'string' || !ALL_STAGES.has(stage)) {
    pushError(errors, 'invalid_stage', String(stage));
  }
  return result(errors);
}

/**
 * @param {unknown} goal
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConversationGoal(goal) {
  const errors = [];
  if (goal == null) return result(errors);
  if (typeof goal !== 'string' || !GOALS.has(goal)) {
    pushError(errors, 'invalid_goal', String(goal));
  }
  return result(errors);
}

/**
 * @param {unknown} intent
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateIntent(intent) {
  const errors = [];
  if (intent == null) return result(errors);
  if (typeof intent !== 'string' || !INTENTS.has(intent)) {
    pushError(errors, 'invalid_intent', String(intent));
  }
  return result(errors);
}

/**
 * Slots internos mínimos (nombres estables F1+).
 * @type {readonly string[]}
 */
const CORE_SLOT_NAMES = Object.freeze([
  'fullName',
  'locationText',
  'expectedPrice',
  'budget',
  'bedrooms',
  'propertyType',
  'occupancyStatus',
  'handoff_consent',
  'advisor_contact_consent',
]);

/**
 * @param {unknown} slotName
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSlotName(slotName) {
  const errors = [];
  if (typeof slotName !== 'string' || !CORE_SLOT_NAMES.includes(slotName)) {
    pushError(errors, 'unknown_slot', String(slotName));
  }
  return result(errors);
}

module.exports = {
  CONVERSATION_STAGES,
  CONVERSATION_GOALS,
  V3_INTENT,
  CORE_SLOT_NAMES,
  validateStage,
  validateConversationGoal,
  validateIntent,
  validateSlotName,
};
