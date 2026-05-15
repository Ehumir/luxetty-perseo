'use strict';

const { ADVISOR_CONTACT_CONSENT } = require('../types/constants');
const { resolveQualificationFlowKey } = require('../planner/flowKeys');

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @returns {Record<string, unknown>|null}
 */
function buildCrmDryRunPayload(state) {
  if (state.advisorContactConsent !== ADVISOR_CONTACT_CONSENT.ACCEPTED) return null;
  if (!state.qualificationComplete) return null;

  const flowKey = resolveQualificationFlowKey(state);
  const intent = state.conversationGoal || null;

  /** @type {Record<string, unknown>} */
  const payload = {
    intent,
    flow_key: flowKey,
    full_name: state.collectedFields?.fullName ?? null,
    location: state.locationText ?? null,
    property_type: state.propertyType || state.collectedFields?.propertyType || null,
    advisor_contact_consent: state.advisorContactConsent,
    lead_flow: state.leadFlow ?? null,
    operation_type: state.operationType ?? null,
  };

  if (state.expectedPrice != null) payload.expected_price = state.expectedPrice;
  if (state.budget != null) payload.budget = state.budget;
  if (state.propertyListingCode) payload.property_listing_code = state.propertyListingCode;
  if (state.occupancyStatus || state.collectedFields?.occupancyStatus) {
    payload.occupancy_status = state.occupancyStatus || state.collectedFields?.occupancyStatus;
  }

  return payload;
}

module.exports = {
  buildCrmDryRunPayload,
};
