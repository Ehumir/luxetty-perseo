'use strict';

const { createEmptyDecision } = require('../types/conversationDecision');
const { isPlainObject, isFiniteNumber, pushError, result } = require('./_helpers');

/**
 * @param {unknown} decision
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConversationDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) {
    pushError(errors, 'decision_not_object');
    return result(errors);
  }

  if (decision.detectedIntent != null && typeof decision.detectedIntent !== 'string') {
    pushError(errors, 'detected_intent_not_string');
  }
  if (!isFiniteNumber(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
    pushError(errors, 'confidence_out_of_range');
  }
  if (!isPlainObject(decision.extractedEntities)) {
    pushError(errors, 'extracted_entities_not_object');
  }
  if (!Array.isArray(decision.warnings)) {
    pushError(errors, 'warnings_not_array');
  }

  const flags = [
    'shouldAskName',
    'shouldEscalateHuman',
    'shouldCreateLead',
    'shouldSearchProperty',
    'explicitFlowSwitch',
    'inventedPropertyClaim',
  ];
  for (const key of flags) {
    if (typeof decision[key] !== 'boolean') {
      pushError(errors, `${key}_not_boolean`);
    }
  }

  if (
    decision.nextSuggestedStage != null &&
    typeof decision.nextSuggestedStage !== 'string'
  ) {
    pushError(errors, 'next_suggested_stage_not_string');
  }

  return result(errors);
}

module.exports = {
  validateConversationDecision,
  createEmptyDecision,
};
