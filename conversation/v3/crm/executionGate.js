'use strict';

const { CONVERSATION_STAGES, ADVISOR_CONTACT_CONSENT } = require('../types/constants');
const { evaluateV3PrimaryGate, getPerseoV3Config } = require('../../../config/perseoV3Flags');

/**
 * @param {{
 *   state: import('../types/conversationState').ConversationState,
 *   phone?: string|null,
 *   rawPhone?: string|null,
 *   config?: ReturnType<typeof getPerseoV3Config>,
 *   primaryGate?: ReturnType<typeof evaluateV3PrimaryGate>,
 * }} input
 */
function evaluateV3CrmExecutionGate(input) {
  const state = input.state || {};
  const cfg = input.config || getPerseoV3Config();
  const gate =
    input.primaryGate ||
    evaluateV3PrimaryGate({
      phone: input.phone || state.phone || '',
      rawPhone: input.rawPhone || null,
    });

  if (!cfg.enabled) {
    return { eligible: false, reason: 'v3_disabled', gate };
  }
  if (!gate.allowlist_match) {
    return { eligible: false, reason: 'allowlist_no_match', gate };
  }
  if (!cfg.crmExecute) {
    return { eligible: false, reason: 'crm_execute_disabled', gate };
  }
  if (state.conversationStage !== CONVERSATION_STAGES.CRM_READY) {
    return { eligible: false, reason: 'stage_not_crm_ready', gate };
  }
  if (
    state.handoffStage != null &&
    state.handoffStage !== '' &&
    state.handoffStage !== CONVERSATION_STAGES.CRM_READY
  ) {
    return { eligible: false, reason: 'handoff_stage_not_crm_ready', gate };
  }
  if (state.advisorContactConsent !== ADVISOR_CONTACT_CONSENT.ACCEPTED) {
    return { eligible: false, reason: 'consent_not_accepted', gate };
  }
  if (state.crmPayloadReady !== true) {
    return { eligible: false, reason: 'crm_payload_not_ready', gate };
  }
  if (state.crmExecutionCompleted === true) {
    return { eligible: false, reason: 'already_executed', gate };
  }

  return { eligible: true, reason: null, gate };
}

module.exports = {
  evaluateV3CrmExecutionGate,
};
