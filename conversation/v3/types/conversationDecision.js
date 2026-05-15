'use strict';

/**
 * @typedef {object} ExtractedEntities
 * @property {string|null} [fullName]
 * @property {string|null} [locationText]
 * @property {number|null} [expectedPrice]
 * @property {number|null} [budget]
 */

/**
 * @typedef {object} ConversationDecision
 * @property {string|null} detectedIntent
 * @property {number} confidence
 * @property {ExtractedEntities} extractedEntities
 * @property {string|null} nextSuggestedStage
 * @property {boolean} shouldAskName
 * @property {boolean} shouldEscalateHuman
 * @property {boolean} shouldCreateLead
 * @property {boolean} shouldSearchProperty
 * @property {boolean} explicitFlowSwitch
 * @property {boolean} inventedPropertyClaim
 * @property {string[]} warnings
 */

/**
 * @returns {ConversationDecision}
 */
function createEmptyDecision() {
  return {
    detectedIntent: null,
    confidence: 0,
    extractedEntities: {},
    nextSuggestedStage: null,
    shouldAskName: false,
    shouldEscalateHuman: false,
    shouldCreateLead: false,
    shouldSearchProperty: false,
    explicitFlowSwitch: false,
    inventedPropertyClaim: false,
    warnings: [],
  };
}

module.exports = {
  createEmptyDecision,
};
