'use strict';

const { CONVERSATION_STAGES, ADVISOR_CONTACT_CONSENT } = require('../conversation/v3/types/constants');
const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');

/**
 * @param {import('../conversation/v3/types/conversationState').ConversationState|null} v3State
 * @param {object} [legacyAiState]
 */
function buildConversationSnapshot(v3State, legacyAiState = {}) {
  const projected = v3State ? mapV3StateToLegacyAiState(v3State) : {};
  const legacy = { ...(legacyAiState || {}), ...projected };
  const stage = v3State?.conversationStage || legacy.conversation_stage || 'OPEN';
  const consent =
    v3State?.advisorContactConsent ||
    legacy.advisor_contact_consent ||
    ADVISOR_CONTACT_CONSENT.PENDING;

  return {
    detected_intent: legacy.intent_type || legacy.playbook_type || v3State?.intentType || null,
    conversation_stage: stage,
    conversation_goal: v3State?.conversationGoal || legacy.conversation_goal || legacy.user_goal || null,
    lead_flow: legacy.lead_flow || legacy.lead_type || null,
    operation_type: legacy.interested_in_operation || v3State?.operationType || null,
    known_name: v3State?.collectedFields?.fullName || legacy.full_name || null,
    known_budget: v3State?.budget ?? legacy.budget_max ?? legacy.budget_min ?? null,
    known_zone: v3State?.locationText || legacy.location_text || null,
    property_code: v3State?.propertyListingCode || legacy.property_code || null,
    interested_property_id:
      v3State?.activeProperty?.id != null
        ? String(v3State.activeProperty.id)
        : legacy.interested_property_id || null,
    crm_ready: stage === CONVERSATION_STAGES.CRM_READY && v3State?.crmPayloadReady === true,
    advisor_contact_consent: consent,
    handoff_sent: !!(v3State?.handoffSent || legacy.handoff_sent),
  };
}

module.exports = {
  buildConversationSnapshot,
};
