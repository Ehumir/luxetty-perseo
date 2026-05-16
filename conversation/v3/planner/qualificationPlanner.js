'use strict';

const { resolveQualificationFlowKey } = require('./flowKeys');

/** @type {Record<string, string[]>} */
const REQUIRED_SLOTS_BY_FLOW = Object.freeze({
  sellOffer: ['full_name', 'location_text', 'expected_price', 'property_type', 'occupancy_status'],
  rentOffer: ['full_name', 'location_text', 'expected_price', 'property_type', 'occupancy_status'],
  buyDemand: ['full_name', 'location_text', 'budget', 'property_type'],
  rentDemand: ['full_name', 'location_text', 'budget'],
  propertyInquiryDemand: ['property_listing_code', 'full_name'],
});

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} slotId
 */
function getSlotValue(state, slotId) {
  switch (slotId) {
    case 'full_name':
      return state.collectedFields?.fullName || null;
    case 'location_text':
      return state.locationText || null;
    case 'expected_price':
      return state.expectedPrice != null ? state.expectedPrice : null;
    case 'budget':
      return state.budget != null ? state.budget : null;
    case 'property_type':
      return state.propertyType || state.collectedFields?.propertyType || null;
    case 'occupancy_status':
      return state.occupancyStatus || state.collectedFields?.occupancyStatus || null;
    case 'property_listing_code':
      return state.propertyListingCode || null;
    default:
      return null;
  }
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function evaluateQualification(state) {
  const flowKey = resolveQualificationFlowKey(state);
  if (!flowKey) {
    return {
      flowKey: null,
      nextSlot: 'intent',
      missingSlots: ['intent'],
      sufficientForHandoff: false,
      qualificationComplete: false,
      plannerReason: 'no_flow',
    };
  }

  const required = REQUIRED_SLOTS_BY_FLOW[flowKey] || [];
  const missingSlots = required.filter((slot) => !getSlotValue(state, slot));
  const qualificationComplete = missingSlots.length === 0;

  return {
    flowKey,
    nextSlot: qualificationComplete ? null : missingSlots[0],
    missingSlots,
    sufficientForHandoff: qualificationComplete,
    qualificationComplete,
    plannerReason: qualificationComplete ? 'conversion_ready' : `missing_${missingSlots[0]}`,
  };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {ReturnType<typeof evaluateQualification>} plannerOut
 */
function buildPlannerStatePatch(state, plannerOut) {
  return {
    qualificationComplete: plannerOut.qualificationComplete === true,
    qualificationMissingSlots: [...(plannerOut.missingSlots || [])],
    awaitingField: plannerOut.qualificationComplete
      ? state.awaitingField
      : plannerOut.nextSlot || state.awaitingField,
  };
}

module.exports = {
  REQUIRED_SLOTS_BY_FLOW,
  getSlotValue,
  evaluateQualification,
  buildPlannerStatePatch,
};
