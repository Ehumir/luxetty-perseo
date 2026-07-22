'use strict';

/**
 * Slots unificados de demanda (op / zona / budget / bedrooms).
 * Normaliza dual schema camelCase (V3) ↔ snake_case (ai_state).
 */

const { cleanSpaces } = require('../../../utils/text');

function toFiniteNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {object} state — ConversationState o ai_state legacy
 * @returns {{
 *   operationType: 'rent'|'sale'|null,
 *   locationText: string|null,
 *   budgetMax: number|null,
 *   bedrooms: number|null,
 *   leadFlow: string|null,
 *   conversationGoal: string|null,
 * }}
 */
function readDemandSlots(state = {}) {
  const s = state && typeof state === 'object' ? state : {};
  const opRaw = String(s.operation_type || s.operationType || '').toLowerCase();
  let operationType = null;
  if (opRaw === 'rent' || opRaw === 'renta') operationType = 'rent';
  else if (opRaw === 'sale' || opRaw === 'venta' || opRaw === 'buy') operationType = 'sale';

  const goal = String(s.conversation_goal || s.conversationGoal || '') || null;
  if (!operationType && goal === 'RENT_PROPERTY') operationType = 'rent';
  if (!operationType && goal === 'BUY_PROPERTY') operationType = 'sale';

  const locationText =
    cleanSpaces(String(s.location_text || s.locationText || '')) || null;

  let budgetMax = toFiniteNumber(s.budget_max);
  if (budgetMax == null) budgetMax = toFiniteNumber(s.budget);

  const bedrooms = toFiniteNumber(s.bedrooms);

  const leadFlow = s.lead_flow || s.leadFlow || null;

  return {
    operationType,
    locationText,
    budgetMax,
    bedrooms,
    leadFlow: leadFlow ? String(leadFlow) : null,
    conversationGoal: goal,
  };
}

/**
 * Patch snake_case para persistir en ai_state / contextualMemoryResolver.
 */
function toAiStatePatch(slots = {}) {
  const patch = {};
  if (slots.operationType != null) patch.operation_type = slots.operationType;
  if (slots.locationText != null) patch.location_text = slots.locationText;
  if (slots.budgetMax != null) patch.budget_max = slots.budgetMax;
  if (slots.bedrooms != null) patch.bedrooms = slots.bedrooms;
  if (slots.leadFlow != null) patch.lead_flow = slots.leadFlow;
  if (slots.conversationGoal != null) patch.conversation_goal = slots.conversationGoal;
  return patch;
}

/**
 * Patch camelCase para ConversationState V3.
 */
function toV3StatePatch(slots = {}) {
  const patch = {};
  if (slots.operationType != null) patch.operationType = slots.operationType;
  if (slots.locationText != null) patch.locationText = slots.locationText;
  if (slots.budgetMax != null) patch.budget = slots.budgetMax;
  if (slots.bedrooms != null) patch.bedrooms = slots.bedrooms;
  if (slots.leadFlow != null) patch.leadFlow = slots.leadFlow;
  if (slots.conversationGoal != null) patch.conversationGoal = slots.conversationGoal;
  return patch;
}

/**
 * Merge: previous slots + inbound overrides (non-null wins from inbound).
 */
function mergeDemandSlots(previous = {}, inbound = {}) {
  const prev = readDemandSlots(previous);
  const next = { ...prev };
  if (inbound.operationType) next.operationType = inbound.operationType;
  if (inbound.locationText) next.locationText = inbound.locationText;
  if (inbound.budgetMax != null) next.budgetMax = inbound.budgetMax;
  if (inbound.bedrooms != null) next.bedrooms = inbound.bedrooms;
  if (inbound.leadFlow) next.leadFlow = inbound.leadFlow;
  if (inbound.conversationGoal) next.conversationGoal = inbound.conversationGoal;
  return next;
}

/**
 * Meta de búsqueda consultiva (persistible).
 */
function buildInventorySearchMeta({
  attempted = false,
  source = 'none',
  operation = null,
  zone = null,
  budgetMax = null,
  bedrooms = null,
  relaxedZone = false,
  emptyAfterSearch = false,
} = {}) {
  return {
    attempted: !!attempted,
    source: source || 'none',
    operation: operation || null,
    zone: zone || null,
    budgetMax: budgetMax != null && Number.isFinite(Number(budgetMax)) ? Number(budgetMax) : null,
    bedrooms: bedrooms != null && Number.isFinite(Number(bedrooms)) ? Number(bedrooms) : null,
    relaxedZone: !!relaxedZone,
    emptyAfterSearch: !!emptyAfterSearch,
  };
}

module.exports = {
  readDemandSlots,
  toAiStatePatch,
  toV3StatePatch,
  mergeDemandSlots,
  buildInventorySearchMeta,
  toFiniteNumber,
};
