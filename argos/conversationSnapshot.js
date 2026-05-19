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
    operation_type: v3State?.operationType || legacy.operation_type || legacy.interested_in_operation || null,
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
    property_history: Array.isArray(v3State?.propertyHistory)
      ? v3State.propertyHistory.map((h) => h?.code).filter(Boolean)
      : [],
    valuation_requested: v3State?.valuationRequested === true,
    price_unknown: v3State?.priceUnknown === true,
    occupancy_status: v3State?.occupancyStatus || v3State?.collectedFields?.occupancyStatus || null,
    policy_decision: v3State?.lastPolicyDecision || null,
    policy_rule_id: v3State?.lastPolicyRuleId || null,
    media_intake_mode: v3State?.lastMediaIntake?.mode || null,
    logical_turn_source: v3State?.lastLogicalTurnSource || null,
    resilience_question_count: Number(v3State?.entityTracker?.last_questions?.length || 0),
    resilience_multi_question:
      v3State?.lastResilienceMetrics?.multi_question === true ||
      (v3State?.entityTracker?.last_questions?.length || 0) > 1,
    resilience_ambiguity_resolved: v3State?.lastResilienceMetrics?.ambiguity_resolved === true,
    tracked_name: v3State?.entityTracker?.name || null,
    crm_queue_status: v3State?.crmQueueStatus || null,
    humanity_tone: v3State?.lastHumanityTone || null,
    crm_runtime_mode: v3State?.crmRuntimeMode || null,
    understanding_fused: !!(v3State?.understanding?.fused_turn?.fused_text),
    understanding_thread_count: Number(v3State?.understanding?.threads?.length || 0),
    understanding_memory_summary: v3State?.understanding?.memory_summary || null,
    anti_loop_score: v3State?.lastResilienceRuntime?.anti_loop_score ?? null,
    confusion_detected: v3State?.lastResilienceRuntime?.confusion_detected === true,
    escalation_confidence: v3State?.lastResilienceRuntime?.escalation_confidence ?? null,
    recovery_plan_action: v3State?.recoveryPlan?.action || null,
    telemetry_recorded: v3State?.lastTelemetryRecorded === true,
    telemetry_mode: v3State?.lastTelemetryMode || null,
    media_runtime_provider:
      v3State?.lastMediaIntake?.provider || v3State?.lastLogicalTurnSource || null,
    policy_runtime_applied: v3State?.lastPolicyRuntimeApplied === true,
    policy_runtime_rule_id: v3State?.lastPolicyRuntimeRuleId || null,
  };
}

module.exports = {
  buildConversationSnapshot,
};
