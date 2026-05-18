'use strict';

const { CONVERSATION_GOALS } = require('../types/constants');

/**
 * Intent legacy (`buy`, `sell`, …) derivado del goal V3 para paneles ARGOS/CRM.
 * @param {string|null|undefined} goal
 * @param {string|null|undefined} leadFlow
 */
function mapGoalToLegacyIntent(goal, leadFlow) {
  switch (goal) {
    case CONVERSATION_GOALS.BUY_PROPERTY:
      return 'buy';
    case CONVERSATION_GOALS.SELL_PROPERTY:
      return 'sell';
    case CONVERSATION_GOALS.RENT_PROPERTY:
      return 'rent';
    case CONVERSATION_GOALS.RENT_OUT_PROPERTY:
      return 'rent_out';
    case CONVERSATION_GOALS.PROPERTY_INQUIRY:
      return 'property_interest';
    default:
      if (leadFlow === 'demand') return 'buy';
      if (leadFlow === 'offer') return 'sell';
      return null;
  }
}

/**
 * Proyecta estado V3 in-memory al shape legacy `ai_state` (Supabase + !state QA).
 * @param {import('../types/conversationState').ConversationState|null|undefined} v3State
 * @returns {Record<string, unknown>}
 */
function mapV3StateToLegacyAiState(v3State) {
  if (!v3State || typeof v3State !== 'object') return {};

  const code = v3State.propertyListingCode != null ? String(v3State.propertyListingCode).trim() : '';

  const intentType = mapGoalToLegacyIntent(v3State.conversationGoal, v3State.leadFlow);

  return {
    lead_flow: v3State.leadFlow ?? null,
    lead_type: v3State.leadFlow ?? null,
    intent_type: intentType,
    playbook_type: intentType,
    operation_type: v3State.operationType ?? null,
    full_name: v3State.collectedFields?.fullName ?? null,
    awaiting_field: v3State.awaitingField ?? null,
    last_asked_field: v3State.lastAskedField ?? null,
    location_text: v3State.locationText ?? null,
    property_type: v3State.propertyType ?? v3State.collectedFields?.propertyType ?? null,
    occupancy_status: v3State.occupancyStatus ?? v3State.collectedFields?.occupancyStatus ?? null,
    expected_price: v3State.expectedPrice ?? null,
    price_unknown: v3State.priceUnknown === true,
    valuation_requested: v3State.valuationRequested === true,
    budget_max: v3State.budget ?? null,
    bedrooms: v3State.bedrooms ?? null,
    conversation_stage: v3State.conversationStage ?? null,
    identity_state: v3State.identityState ?? null,
    conversation_goal: v3State.conversationGoal ?? null,
    conversation_goal_locked: v3State.conversationGoalLocked === true,
    last_question: v3State.lastAssistantQuestion ?? null,
    v3_primary_active: true,
    qualification_complete: v3State.qualificationComplete === true,
    advisor_contact_consent: v3State.advisorContactConsent ?? null,
    handoff_stage: v3State.handoffStage ?? null,
    crm_payload_ready: v3State.crmPayloadReady === true,
    qualification_missing_slots: Array.isArray(v3State.qualificationMissingSlots)
      ? v3State.qualificationMissingSlots
      : [],
    crm_payload_preview: v3State.crmPayloadPreview ?? null,
    crm_execution_completed: v3State.crmExecutionCompleted === true,
    crm_contact_id: v3State.crmContactId ?? null,
    crm_lead_id: v3State.crmLeadId ?? null,
    handoff_reason: v3State.handoffReason ?? v3State.unhandledReason ?? null,
    property_code: code || null,
    direct_property_code: code || null,
    direct_property_reference: code.length > 0,
    property_specific_intent: v3State.propertySpecificIntent === true || code.length > 0,
    channel_preference: v3State.channelPreference ?? null,
    property_qa_sub_mode: v3State.propertySubMode ?? null,
    v3_loop_risk_score: v3State.loopRiskScore ?? null,
    v3_last_composer_intent: v3State.lastComposerIntent ?? null,
    v3_last_assistant_reply_signature: v3State.lastAssistantReplySignature ?? null,
    sticky_lead_flow: v3State.stickyLeadFlow ?? null,
    sticky_operation_type: v3State.stickyOperationType ?? null,
    sticky_conversation_goal: v3State.stickyConversationGoal ?? null,
    interested_property_id:
      v3State.activeProperty && v3State.activeProperty.id != null ? String(v3State.activeProperty.id) : null,
    property_history: Array.isArray(v3State.propertyHistory) ? v3State.propertyHistory : [],
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
  mapGoalToLegacyIntent,
  mapV3StateToLegacyAiState,
  mergeLegacyAiStateWithV3,
};
