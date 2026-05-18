'use strict';

const { evaluateV3CrmExecutionGate } = require('../conversation/v3/crm/executionGate');
const { CONVERSATION_STAGES, ADVISOR_CONTACT_CONSENT } = require('../conversation/v3/types/constants');
const { getPerseoV3Config } = require('../config/perseoV3Flags');

/**
 * Lista explícita de por qué el gate CRM preview/execute no es elegible.
 */
function collectCrmGateBlockers(state = {}, input = {}) {
  const cfg = getPerseoV3Config();
  const blockers = [];

  if (!cfg.enabled) blockers.push({ code: 'v3_disabled' });
  if (!input.argosPreview && !input.argosMode) {
    const gate = input.primaryGate;
    if (gate && !gate.allowlist_match) blockers.push({ code: 'allowlist_no_match' });
  }
  if (!input.argosPreview && !cfg.crmExecute) blockers.push({ code: 'crm_execute_disabled' });

  if (state.conversationStage !== CONVERSATION_STAGES.CRM_READY) {
    blockers.push({
      code: 'stage_not_crm_ready',
      actual: state.conversationStage || null,
      expected: CONVERSATION_STAGES.CRM_READY,
    });
  }
  if (
    state.handoffStage != null &&
    state.handoffStage !== '' &&
    state.handoffStage !== CONVERSATION_STAGES.CRM_READY
  ) {
    blockers.push({ code: 'handoff_stage_not_crm_ready', actual: state.handoffStage });
  }
  if (state.advisorContactConsent !== ADVISOR_CONTACT_CONSENT.ACCEPTED) {
    blockers.push({
      code: 'consent_not_accepted',
      actual: state.advisorContactConsent || null,
    });
  }
  if (state.crmPayloadReady !== true) {
    blockers.push({ code: 'crm_payload_not_ready', qualificationComplete: state.qualificationComplete });
  }
  if (state.crmExecutionCompleted === true) {
    blockers.push({ code: 'already_executed' });
  }
  if (state.qualificationComplete !== true) {
    blockers.push({
      code: 'qualification_incomplete',
      missing_slots: state.qualificationMissingSlots || [],
    });
  }

  const gate = evaluateV3CrmExecutionGate({
    state,
    phone: input.phone,
    argosMode: input.argosMode,
    argosPreview: input.argosPreview,
  });

  return {
    eligible: gate.eligible,
    primary_reason: gate.reason,
    blockers,
  };
}

module.exports = {
  collectCrmGateBlockers,
};
