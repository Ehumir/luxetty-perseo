'use strict';

const { normalizeText } = require('../../../utils/text');

/** Piso orientativo compra venta (MXN) — orientar sin descartar bruscamente. */
const BUY_SOFT_FLOOR_MXN = 3_000_000;

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasAmbiguousBuyBudgetPhrase(text) {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  if (/\b(no\s+se|no\s+sé|depende|aprox|mas\s+o\s+menos)\b/.test(t) && !/\d/.test(t)) return true;
  if (/\b(por\s+debajo|menos\s+de|hasta)\b/.test(t) && !/\d/.test(t)) return true;
  return false;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} [text]
 * @returns {{ status: 'missing'|'valid'|'below_soft_floor'|'ambiguous', budget: number|null, messageHint: string|null }}
 */
function evaluateBuyPricePolicy(state, text = '') {
  const budget = state.budget != null ? Number(state.budget) : null;

  if (hasAmbiguousBuyBudgetPhrase(text) && budget == null) {
    return {
      status: 'ambiguous',
      budget: null,
      messageHint: 'ambiguous_budget',
    };
  }

  if (budget == null || !Number.isFinite(budget)) {
    return { status: 'missing', budget: null, messageHint: null };
  }

  if (budget < BUY_SOFT_FLOOR_MXN) {
    return {
      status: 'below_soft_floor',
      budget,
      messageHint: 'below_soft_floor',
    };
  }

  return { status: 'valid', budget, messageHint: null };
}

module.exports = {
  BUY_SOFT_FLOOR_MXN,
  evaluateBuyPricePolicy,
  hasAmbiguousBuyBudgetPhrase,
};
