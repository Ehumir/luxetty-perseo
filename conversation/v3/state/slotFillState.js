'use strict';

const { getSlotValue } = require('../planner/qualificationPlanner');

/**
 * Slots ya capturados en estado (para no re-preguntar).
 * @param {import('../types/conversationState').ConversationState} state
 */
function getFilledSlots(state) {
  if (!state) return {};
  return {
    full_name: !!getSlotValue(state, 'full_name'),
    location_text: !!getSlotValue(state, 'location_text'),
    budget: getSlotValue(state, 'budget') != null,
    expected_price: getSlotValue(state, 'expected_price') != null,
    property_type: !!getSlotValue(state, 'property_type'),
    advisor_contact_consent:
      state.advisorContactConsent === 'ACCEPTED' || state.advisorContactConsent === 'DECLINED',
  };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} slotId
 */
function isSlotFilled(state, slotId) {
  if (slotId === 'property_type_or_bedrooms') {
    return !!(state.propertyType || state.bedrooms != null);
  }
  return getSlotValue(state, slotId) != null && getSlotValue(state, slotId) !== '';
}

module.exports = {
  getFilledSlots,
  isSlotFilled,
};
