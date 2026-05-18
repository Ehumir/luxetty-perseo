'use strict';

const { evaluateV3CrmExecutionGate } = require('../conversation/v3/crm/executionGate');
const {
  buildV3CrmExecutionPayload,
  mapV3StateToLeadAutomationAiState,
} = require('../conversation/v3/crm/executionPayload');
const { previewContactForConversation } = require('../services/contactProvisioning');
const { previewLeadFromConversation } = require('../services/leadAutomation');
const { validateOwnership } = require('./ownershipValidator');
const { traceEvent } = require('./argosTrace');

/**
 * @param {{
 *   v3State: object,
 *   phone_sim: string,
 *   sessionMeta?: object,
 *   supabase: object,
 *   property?: object|null,
 *   propertyId?: string|null,
 *   waProfileName?: string|null,
 *   trace?: ReturnType<import('./argosTrace').createArgosTrace>,
 * }} input
 */
async function previewCrmPipeline(input) {
  const trace = input.trace;
  const v3State = input.v3State || {};
  const phone = input.phone_sim;
  const sessionMeta = input.sessionMeta || {};
  const conversationId = v3State.conversationId || sessionMeta.conversation_id || 'argos:preview';

  const gate = evaluateV3CrmExecutionGate({
    state: v3State,
    phone,
    argosMode: true,
    argosPreview: true,
  });

  if (trace) {
    traceEvent(trace, {
      type: 'crm_execution_gate',
      phase: 'gate',
      visibility: 'debug',
      payload: { eligible: gate.eligible, reason: gate.reason },
    });
  }

  if (!gate.eligible) {
    return {
      skipped: true,
      reason: gate.reason,
      errors: [],
      warnings: [],
    };
  }

  const executionPayload = buildV3CrmExecutionPayload(v3State, phone);
  if (!executionPayload) {
    return {
      skipped: true,
      reason: 'payload_build_failed',
      errors: ['payload_build_failed'],
      warnings: [],
    };
  }

  const aiState = mapV3StateToLeadAutomationAiState(v3State, executionPayload);
  if (sessionMeta.qa_crm_force_new_lead) {
    aiState.qa_crm_force_new_lead = true;
  }

  const conversationRow = {
    id: conversationId,
    phone,
    contact_id: sessionMeta.contact_id || v3State.contactId || null,
    lead_id: sessionMeta.lead_id || v3State.leadId || null,
    assigned_agent_profile_id: sessionMeta.assigned_agent_profile_id || null,
    channel: 'whatsapp',
    ai_state: aiState,
  };

  const contactPlan = await previewContactForConversation({
    supabase: input.supabase,
    conversationRow,
    state: {
      full_name: v3State.collectedFields?.fullName || executionPayload.contact_name,
    },
    phone,
    waName: input.waProfileName || executionPayload.contact_name,
    property: input.property || null,
  });

  if (trace) {
    traceEvent(trace, {
      type: 'contact_plan',
      phase: 'crm_preview',
      visibility: 'debug',
      payload: contactPlan,
    });
  }

  const syntheticContactId =
    contactPlan.contact_id || sessionMeta.contact_id || '00000000-0000-0000-0000-000000000099';

  const leadPlan = await previewLeadFromConversation({
    supabase: input.supabase,
    conversation: conversationRow,
    aiState,
    contactId: contactPlan.action === 'would_skip' ? null : syntheticContactId,
    propertyId: input.propertyId || executionPayload.interested_property_id || null,
    property: input.property || null,
    contactWasCreated: contactPlan.wasCreated === true,
    logger: console,
  });

  if (trace) {
    traceEvent(trace, {
      type: 'lead_plan',
      phase: 'crm_preview',
      visibility: 'debug',
      payload: leadPlan,
    });
    traceEvent(trace, {
      type: 'assignment_decision',
      phase: 'crm_preview',
      visibility: 'debug',
      source: { module: 'services/assignmentDecision', fn: 'resolveAssignmentDecision' },
      payload: {
        strategy: leadPlan.assignment_strategy,
        path: leadPlan.assignment_path,
        assigned_agent_profile_id: leadPlan.assigned_agent_profile_id,
        candidates: leadPlan.assignment_candidates,
        would_assign_agent: leadPlan.would_assign_agent,
        why_not_assigned: leadPlan.why_not_assigned,
      },
    });
  }

  if (trace && leadPlan.reason) {
    traceEvent(trace, {
      type: 'lead_not_planned',
      phase: 'crm_preview',
      visibility: 'debug',
      payload: { why_not_created: leadPlan.reason },
    });
  }

  const propertyAgentId =
    input.property?.agent_profile_id || input.property?.assigned_agent_profile_id || null;

  const ownership_validation = validateOwnership({
    contactPreview: contactPlan,
    leadPreview: leadPlan,
    propertyAgentProfileId: propertyAgentId,
    aiState,
  });

  if (trace) {
    traceEvent(trace, {
      type: ownership_validation.passed ? 'ownership_validation_pass' : 'ownership_validation_fail',
      phase: 'ownership',
      visibility: 'debug',
      payload: ownership_validation,
    });
  }

  return {
    skipped: false,
    contact: {
      action: contactPlan.action,
      would_create_contact: contactPlan.would_create_contact,
      would_reuse_contact: contactPlan.would_reuse_contact,
      contact_id: contactPlan.contact_id,
      normalized_whatsapp: contactPlan.normalized_whatsapp,
      assigned_agent_profile_id: contactPlan.assigned_agent_profile_id,
    },
    lead: {
      action: leadPlan.action,
      would_create_lead: leadPlan.would_create_lead,
      would_reuse_lead: leadPlan.would_reuse_lead,
      lead_id: leadPlan.lead_id,
      lead_type: leadPlan.lead_type,
      operation: leadPlan.operation,
      interested_property_id: leadPlan.interested_property_id,
      assigned_agent_profile_id: leadPlan.assigned_agent_profile_id,
      assignment_strategy: leadPlan.assignment_strategy,
    },
    conversation: {
      would_link_conversation: true,
      would_update_ai_state: true,
    },
    assignment: {
      assignment_strategy: leadPlan.assignment_strategy,
      assigned_agent_profile_id: leadPlan.assigned_agent_profile_id,
    },
    ownership_validation,
    notifications: {
      would_notify_agent: false,
    },
    errors: [],
    warnings: ownership_validation.passed ? [] : ['ownership_validation_failed'],
  };
}

module.exports = {
  previewCrmPipeline,
};
