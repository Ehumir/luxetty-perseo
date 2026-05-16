'use strict';

const { resolveQualificationFlowKey } = require('./flowKeys');

/** @type {Record<string, string[]>} */
const REQUIRED_SLOTS_BY_FLOW = Object.freeze({
  sellOffer: ['full_name', 'location_text', 'expected_price', 'property_type', 'occupancy_status'],
  rentOffer: ['full_name', 'location_text', 'expected_price', 'property_type', 'occupancy_status'],
  buyDemand: ['full_name', 'location_text', 'budget', 'property_type_or_bedrooms'],
  rentDemand: ['full_name', 'location_text', 'budget'],
  propertyInquiryDemand: ['property_listing_code', 'full_name'],
});

const BUY_DEMAND_ORDER = ['full_name', 'location_text', 'budget', 'property_type_or_bedrooms'];

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function getBuyDemandMissingSlots(state) {
  /** @type {string[]} */
  const missing = [];
  if (!state.collectedFields?.fullName) missing.push('full_name');
  if (!state.locationText) missing.push('location_text');
  if (state.budget == null) missing.push('budget');
  if (!state.propertyType && state.bedrooms == null) missing.push('property_type_or_bedrooms');
  return missing;
}

/**
 * @param {string[]} missing
 */
function resolveBuyDemandNextSlot(missing) {
  if (!missing.length) return null;
  for (const slot of BUY_DEMAND_ORDER) {
    if (missing.includes(slot)) {
      if (slot === 'property_type_or_bedrooms') return 'property_type';
      return slot;
    }
  }
  return missing[0];
}

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
    case 'property_type_or_bedrooms':
      return state.propertyType || state.bedrooms != null ? 'ok' : null;
    case 'bedrooms':
      return state.bedrooms != null ? state.bedrooms : null;
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

  if (flowKey === 'buyDemand') {
    const missingSlots = getBuyDemandMissingSlots(state);
    const qualificationComplete = missingSlots.length === 0;
    const nextSlot = qualificationComplete ? null : resolveBuyDemandNextSlot(missingSlots);
    return {
      flowKey,
      nextSlot,
      missingSlots,
      sufficientForHandoff: qualificationComplete,
      qualificationComplete,
      plannerReason: qualificationComplete ? 'conversion_ready' : `missing_${missingSlots[0]}`,
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
  getBuyDemandMissingSlots,
  evaluateQualification,
  buildPlannerStatePatch,
};
