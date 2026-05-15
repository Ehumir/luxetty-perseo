'use strict';

const { CONVERSATION_GOALS } = require('../types/constants');

/**
 * Alinea `context_fusion` y banderas legacy con el estado ganador de V3 primary
 * para evitar drift (p. ej. venta vs renta) en la misma persistencia.
 * @param {Record<string, unknown>} nextAiState
 */
function sanitizeV3PrimaryLegacyAiState(nextAiState) {
  if (!nextAiState || typeof nextAiState !== 'object') return nextAiState;
  if (nextAiState.v3_primary_active !== true) return nextAiState;

  const goal = nextAiState.conversation_goal;
  const leadFlow = nextAiState.lead_flow;
  const op = nextAiState.operation_type;

  const categoryByGoal = {
    [CONVERSATION_GOALS.SELL_PROPERTY]: 'sell_property',
    [CONVERSATION_GOALS.BUY_PROPERTY]: 'buy_property',
    [CONVERSATION_GOALS.RENT_PROPERTY]: 'rent_property',
    [CONVERSATION_GOALS.RENT_OUT_PROPERTY]: 'rent_out_property',
    [CONVERSATION_GOALS.PROPERTY_INQUIRY]: 'ask_property_info',
  };

  const fusion =
    nextAiState.context_fusion && typeof nextAiState.context_fusion === 'object'
      ? { ...nextAiState.context_fusion }
      : {};

  const cat = categoryByGoal[goal];
  if (cat) {
    fusion.normalizedIntent = {
      ...(typeof fusion.normalizedIntent === 'object' && fusion.normalizedIntent ? fusion.normalizedIntent : {}),
      category: cat,
      confidence: 0.78,
      source: 'v3_primary_alignment',
    };
  }

  if (leadFlow === 'offer' && op === 'sale') {
    fusion.offer_context =
      typeof fusion.offer_context === 'object' && fusion.offer_context
        ? { ...fusion.offer_context, operation: 'venta' }
        : { operation: 'venta' };
  } else if (leadFlow === 'offer' && op === 'rent') {
    fusion.offer_context =
      typeof fusion.offer_context === 'object' && fusion.offer_context
        ? { ...fusion.offer_context, operation: 'renta' }
        : { operation: 'renta' };
  } else if (leadFlow === 'demand' && op === 'rent') {
    fusion.demand_context =
      typeof fusion.demand_context === 'object' && fusion.demand_context
        ? { ...fusion.demand_context, operation: 'renta' }
        : { operation: 'renta' };
  } else if (leadFlow === 'demand' && op === 'sale') {
    fusion.demand_context =
      typeof fusion.demand_context === 'object' && fusion.demand_context
        ? { ...fusion.demand_context, operation: 'compra' }
        : { operation: 'compra' };
  }

  nextAiState.context_fusion = fusion;

  const hasCode = !!String(nextAiState.property_code || nextAiState.direct_property_code || '').trim();
  if (!hasCode) {
    delete nextAiState.property_unavailable_template;
    delete nextAiState.property_not_found_reply;
  }

  return nextAiState;
}

module.exports = {
  sanitizeV3PrimaryLegacyAiState,
};
