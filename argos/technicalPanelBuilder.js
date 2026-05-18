'use strict';

const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');

/**
 * @param {{
 *   v3State?: object|null,
 *   legacyAiState?: object,
 *   crmDryRun?: object|null,
 *   gates?: object,
 * }} input
 */
function buildTechnicalPanel(input) {
  const v3 = input.v3State || {};
  const projected = v3 && Object.keys(v3).length ? mapV3StateToLegacyAiState(v3) : {};
  const legacy = { ...(input.legacyAiState || {}), ...projected };
  const crm = input.crmDryRun || null;
  const contact = crm?.contact || {};
  const lead = crm?.lead || {};
  const assignment = crm?.assignment || {};

  return {
    intent: legacy.intent_type || legacy.playbook_type || v3.intentType || null,
    lead_type: lead.lead_type || legacy.lead_type || legacy.lead_flow || null,
    operation: lead.operation || legacy.interested_in_operation || v3.operationType || null,
    zone: v3.locationText || legacy.location_text || null,
    would_ask_name: legacy.pending_name_request === true || legacy.asked_name === false,
    would_handoff: legacy.wants_human === true || legacy.handoff_sent === true,
    would_create_contact: contact.would_create_contact === true,
    would_reuse_contact: contact.would_reuse_contact === true,
    would_create_lead: lead.would_create_lead === true,
    would_reuse_lead: lead.would_reuse_lead === true,
    assignment_strategy: assignment.assignment_strategy || lead.assignment_strategy || null,
    assigned_agent_profile_id:
      assignment.assigned_agent_profile_id ||
      lead.assigned_agent_profile_id ||
      contact.assigned_agent_profile_id ||
      null,
  };
}

module.exports = {
  buildTechnicalPanel,
};
