'use strict';

const { createInitialConversationState, mergeConversationState } = require('../types/conversationState');
const { CONVERSATION_GOALS, ADVISOR_CONTACT_CONSENT } = require('../types/constants');

const GOAL_BY_LEGACY_INTENT = {
  buy: CONVERSATION_GOALS.BUY_PROPERTY,
  sell: CONVERSATION_GOALS.SELL_PROPERTY,
  rent: CONVERSATION_GOALS.RENT_PROPERTY,
  rent_out: CONVERSATION_GOALS.RENT_OUT_PROPERTY,
  property_interest: CONVERSATION_GOALS.PROPERTY_INQUIRY,
};

function mapLegacyIntentToGoal(aiState = {}) {
  const goal = aiState.conversation_goal || null;
  if (goal) return goal;
  const intent = String(aiState.intent_type || aiState.playbook_type || '').trim().toLowerCase();
  return GOAL_BY_LEGACY_INTENT[intent] || null;
}

/**
 * Hidrata estado V3 in-memory desde `conversations.ai_state` persistido (Cuarzo §8).
 * @param {string} conversationId
 * @param {string|null} phone
 * @param {object|null|undefined} legacyAiState
 * @returns {import('../types/conversationState').ConversationState|null}
 */
function hydrateV3StateFromLegacyAiState(conversationId, phone, legacyAiState) {
  if (!conversationId || !legacyAiState || typeof legacyAiState !== 'object') return null;

  const legacy = legacyAiState;
  const hasV3Marker =
    legacy.v3_primary_active === true ||
    legacy.conversation_goal != null ||
    legacy.crm_execution_completed === true ||
    legacy.handoff_stage != null ||
    legacy.user_goal != null ||
    legacy.current_intent != null;

  const hasSlots =
    legacy.lead_flow != null ||
    legacy.lead_id != null ||
    legacy.budget_max != null ||
    legacy.location_text != null ||
    legacy.full_name != null ||
    legacy.property_code != null ||
    legacy.direct_property_code != null ||
    legacy.interested_property_id != null ||
    legacy.detected_property_id != null;

  if (!hasV3Marker && !hasSlots) return null;

  const seed = createInitialConversationState({ conversationId, phone });
  const goal = mapLegacyIntentToGoal(legacy);

  const patch = {
    leadFlow: legacy.lead_flow || legacy.lead_type || null,
    operationType: legacy.operation_type || null,
    conversationStage: legacy.conversation_stage || seed.conversationStage,
    identityState: legacy.identity_state || seed.identityState,
    conversationGoal: goal,
    conversationGoalLocked: legacy.conversation_goal_locked === true,
    locationText: legacy.location_text || null,
    propertyType: legacy.property_type || null,
    occupancyStatus: legacy.occupancy_status || null,
    expectedPrice: legacy.expected_price != null ? Number(legacy.expected_price) : null,
    priceUnknown: legacy.price_unknown === true,
    valuationRequested: legacy.valuation_requested === true,
    budget: legacy.budget_max != null ? Number(legacy.budget_max) : null,
    bedrooms: legacy.bedrooms != null ? Number(legacy.bedrooms) : null,
    awaitingField: legacy.awaiting_field || null,
    lastAskedField: legacy.last_asked_field || null,
    advisorContactConsent:
      legacy.advisor_contact_consent != null
        ? legacy.advisor_contact_consent
        : legacy.handoff_sent === true
          ? ADVISOR_CONTACT_CONSENT.ACCEPTED
          : seed.advisorContactConsent,
    qualificationComplete: legacy.qualification_complete === true,
    crmPayloadReady: legacy.crm_payload_ready === true,
    crmPayloadPreview: legacy.crm_payload_preview || null,
    crmExecutionCompleted: legacy.crm_execution_completed === true,
    crmContactId: legacy.crm_contact_id || legacy.integration_contract?.contact_id || null,
    crmLeadId: legacy.crm_lead_id || legacy.lead_id || legacy.integration_contract?.lead_id || null,
    handoffStage: legacy.handoff_stage || null,
    handoffReason: legacy.handoff_reason || null,
    propertyListingCode: legacy.property_code || legacy.direct_property_code || null,
    propertySpecificIntent: legacy.property_specific_intent === true,
    campaignHeadline: legacy.campaign_context?.headline || legacy.campaign_context?.campaign_name || null,
    propertySubMode: legacy.property_qa_sub_mode || null,
    stickyLeadFlow: legacy.sticky_lead_flow || null,
    stickyOperationType: legacy.sticky_operation_type || null,
    stickyConversationGoal: legacy.sticky_conversation_goal || null,
    handoffCompletedAt: legacy.handoff_completed_at || null,
    handoffWaitingFinalConfirmation: legacy.handoff_waiting_final_confirmation === true,
    softClosePending: legacy.soft_close_pending === true,
    conversationSoftClosed: legacy.conversation_soft_closed === true,
    terminalAckClose: legacy.terminal_ack_close === true,
    explicitReopen: legacy.explicit_reopen === true,
    collectedFields: {
      fullName: legacy.full_name || null,
      propertyType: legacy.property_type || null,
      occupancyStatus: legacy.occupancy_status || null,
    },
    lastAssistantQuestion: legacy.last_question || null,
  };

  if (legacy.interested_property_id) {
    patch.activeProperty = {
      id: String(legacy.interested_property_id),
      code: patch.propertyListingCode || null,
    };
    patch.propertySpecificIntent = true;
  }

  if (legacy.detected_property_id && !patch.activeProperty) {
    patch.activeProperty = {
      id: String(legacy.detected_property_id),
      code: patch.propertyListingCode || null,
    };
    patch.propertySpecificIntent = true;
  }

  if (legacy.user_goal || legacy.current_intent) {
    const intent = String(legacy.intent_type || legacy.current_intent || '').trim().toLowerCase();
    if (!patch.conversationGoal && intent) {
      patch.conversationGoal = mapLegacyIntentToGoal({ ...legacy, intent_type: intent });
    }
  }

  return mergeConversationState(seed, patch);
}

module.exports = {
  hydrateV3StateFromLegacyAiState,
  mapLegacyIntentToGoal,
};
