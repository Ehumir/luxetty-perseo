'use strict';

/**
 * Proyecta estado V3 in-memory al shape legacy `ai_state` (Supabase + !state QA).
 * @param {import('../types/conversationState').ConversationState|null|undefined} v3State
 * @returns {Record<string, unknown>}
 */
function mapV3StateToLegacyAiState(v3State) {
  if (!v3State || typeof v3State !== 'object') return {};

  return {
    lead_flow: v3State.leadFlow ?? null,
    operation_type: v3State.operationType ?? null,
    full_name: v3State.collectedFields?.fullName ?? null,
    awaiting_field: v3State.awaitingField ?? null,
    location_text: v3State.locationText ?? null,
    expected_price: v3State.expectedPrice ?? null,
    budget_max: v3State.budget ?? null,
    bedrooms: v3State.bedrooms ?? null,
    conversation_stage: v3State.conversationStage ?? null,
    identity_state: v3State.identityState ?? null,
    conversation_goal: v3State.conversationGoal ?? null,
    conversation_goal_locked: v3State.conversationGoalLocked === true,
    last_question: v3State.lastAssistantQuestion ?? null,
    v3_primary_active: true,
  };
}

/**
 * Mezcla sesión V3 sobre ai_state persistido (prioridad V3 en campos conversacionales).
 * @param {object} legacyAiState
 * @param {import('../types/conversationState').ConversationState|null} v3State
 */
function mergeLegacyAiStateWithV3(legacyAiState, v3State) {
  const base = legacyAiState && typeof legacyAiState === 'object' ? legacyAiState : {};
  const patch = mapV3StateToLegacyAiState(v3State);
  if (!Object.keys(patch).length) return { ...base };
  return { ...base, ...patch };
}

module.exports = {
  mapV3StateToLegacyAiState,
  mergeLegacyAiStateWithV3,
};
