'use strict';

const { IDENTITY_STATES } = require('../types/constants');

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @returns {string}
 */
function resolveIdentityState(state) {
  const name = state.collectedFields && state.collectedFields.fullName;
  if (!name || !String(name).trim()) return IDENTITY_STATES.UNKNOWN;
  const trimmed = String(name).trim();
  if (trimmed.length >= 2) return IDENTITY_STATES.CONFIRMED;
  return IDENTITY_STATES.PARTIAL;
}

module.exports = {
  resolveIdentityState,
};
