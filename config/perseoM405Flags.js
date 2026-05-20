'use strict';

/**
 * M4-05a — Conversational flex quick wins (default OFF).
 * @returns {boolean}
 */
function isConversationalFlexEnabled() {
  return String(process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED || '').toLowerCase() === 'true';
}

module.exports = {
  isConversationalFlexEnabled,
};
