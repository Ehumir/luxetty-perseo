'use strict';

const { isDemandLeadContext } = require('../services/leadAutomation');

/**
 * @param {{
 *   contactPreview: object,
 *   leadPreview: object,
 *   propertyAgentProfileId?: string|null,
 *   aiState?: object,
 * }} input
 */
function validateOwnership(input) {
  const contact = input.contactPreview || {};
  const lead = input.leadPreview || {};
  const propertyAgentId = input.propertyAgentProfileId || null;
  const aiState = input.aiState || {};
  const violations = [];

  const leadType =
    lead.lead_type ||
    aiState.lead_type ||
    (aiState.lead_flow === 'offer' ? 'supply' : aiState.lead_flow === 'demand' ? 'demand' : null);
  const isDemand = isDemandLeadContext(leadType, aiState);
  const contactAgent = contact.assigned_agent_profile_id || null;
  const leadAgent = lead.assigned_agent_profile_id || null;
  const contactWasCreated = contact.wasCreated === true;
  const contactExisted = contact.action === 'would_reuse' || (!contactWasCreated && !!contact.contact_id);

  if (isDemand && contactExisted && contactAgent) {
    if (leadAgent && leadAgent !== contactAgent) {
      violations.push({
        code: 'DEMAND_OWNER_MISMATCH',
        message: 'Demand lead agent must match existing contact owner',
        expected_agent: contactAgent,
        actual_agent: leadAgent,
      });
    }
    return finalize(violations, 'RULE_1_CONTACT_OWNER_DEMAND');
  }

  if (contactWasCreated && propertyAgentId && isDemand) {
    if (leadAgent && leadAgent !== propertyAgentId) {
      violations.push({
        code: 'NEW_CONTACT_PROPERTY_AGENT_MISMATCH',
        message: 'New contact with property should assign lead to property agent',
        expected_agent: propertyAgentId,
        actual_agent: leadAgent,
      });
    }
    if (contact.assigned_agent_profile_id && contact.assigned_agent_profile_id !== propertyAgentId) {
      violations.push({
        code: 'NEW_CONTACT_AGENT_MISMATCH',
        message: 'New contact should be assigned to property agent',
        expected_agent: propertyAgentId,
        actual_agent: contact.assigned_agent_profile_id,
      });
    }
    return finalize(violations, 'RULE_2_PROPERTY_AGENT_NEW_CONTACT');
  }

  if (
    isDemand &&
    !contactAgent &&
    !propertyAgentId &&
    !leadAgent &&
    lead.assignment_path !== 'deferred_not_ready_for_handoff' &&
    lead.assignment_path !== 'deferred_legal_sensitive'
  ) {
    violations.push({
      code: 'MISSING_ASSIGNMENT_FALLBACK',
      message: 'No assignment resolved for demand without contact owner or property',
    });
    return finalize(violations, 'RULE_3_ENGINE_FALLBACK');
  }

  if (!leadAgent && lead.why_not_assigned) {
    return finalize(violations, 'RULE_3_ENGINE_FALLBACK');
  }

  if (contactExisted && contactAgent && propertyAgentId && leadAgent === contactAgent) {
    return finalize(violations, 'RULE_4_PROPERTY_INTEREST_ONLY');
  }

  const strategy = lead.assignment_strategy || null;
  if (strategy && ['assignment_engine', 'dios_fallback', 'dios_mode', 'contact_owner', 'property_owner_agent'].includes(strategy)) {
    return finalize(violations, strategy === 'contact_owner' ? 'RULE_1_CONTACT_OWNER_DEMAND' : 'RULE_3_ENGINE_FALLBACK');
  }

  return finalize(violations, violations.length ? 'OWNERSHIP_VIOLATION' : 'RULE_3_ENGINE_FALLBACK');
}

function finalize(violations, rule) {
  return {
    passed: violations.length === 0,
    rule,
    violations,
  };
}

module.exports = {
  validateOwnership,
};
