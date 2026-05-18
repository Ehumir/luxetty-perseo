'use strict';

function leadAutomationShared() {
  return require('./leadAutomation');
}

function ruleMatchesContext(rule = {}, ctx = {}) {
  const operation = ctx.operationType || null;
  const propertyType = ctx.propertyType || null;
  const budget = Number(ctx.budgetMax || ctx.budgetMin || 0) || null;

  if (rule?.operation_type && operation && rule.operation_type !== operation) return false;
  if (rule?.property_type && propertyType && rule.property_type !== propertyType) return false;
  if (rule?.min_budget != null && budget != null && budget < Number(rule.min_budget)) return false;
  if (rule?.max_budget != null && budget != null && budget > Number(rule.max_budget)) return false;

  return true;
}

function buildHandoffCandidate(lead, aiState, propertyId) {
  return {
    ...lead,
    intent_type: aiState?.intent_type || aiState?.playbook_type || null,
    property_type: aiState?.property_type || lead?.property_type || null,
    wants_human: !!aiState?.wants_human,
    wants_visit: !!aiState?.wants_visit,
    asks_property_details: !!aiState?.asks_property_details,
    property_interest:
      aiState?.intent_type === 'property_interest' ||
      aiState?.playbook_type === 'property_interest' ||
      !!aiState?.direct_property_reference ||
      !!propertyId,
    handoff_sent: !!aiState?.handoff_sent,
  };
}

/**
 * Resolución read-only del motor (god_mode → rules → settings fallback).
 * En preview no invoca RPC assign_lead_via_engine.
 */
async function resolveEngineAssignmentReadOnly(supabase, context, { previewMode = false, logger = console } = {}) {
  if (!supabase?.from) {
    return {
      assignedAgentProfileId: null,
      strategy: null,
      path: 'no_assignment_available',
      wouldInvokeRpc: false,
    };
  }

  const { data: godModes } = await supabase
    .from('assignment_god_modes')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(1);

  const godMode = Array.isArray(godModes) ? godModes[0] : null;
  if (godMode?.target_agent_profile_id) {
    return {
      assignedAgentProfileId: godMode.target_agent_profile_id,
      strategy: 'god_mode',
      path: 'engine_god_mode',
      wouldInvokeRpc: false,
    };
  }

  const { data: rules } = await supabase
    .from('assignment_rules')
    .select('*')
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(25);

  if (Array.isArray(rules)) {
    for (const rule of rules) {
      if (!ruleMatchesContext(rule, context)) continue;
      const { data: ruleAgents } = await supabase
        .from('assignment_rule_agents')
        .select('*')
        .eq('assignment_rule_id', rule.id)
        .eq('is_active', true)
        .order('priority', { ascending: true })
        .limit(5);
      const selectedAgent = Array.isArray(ruleAgents) ? ruleAgents[0] : null;
      if (selectedAgent?.agent_profile_id) {
        return {
          assignedAgentProfileId: selectedAgent.agent_profile_id,
          strategy: 'assignment_rule',
          path: 'engine_rule',
          wouldInvokeRpc: false,
        };
      }
    }
  }

  if (previewMode) {
    const { data: settings } = await supabase
      .from('assignment_settings')
      .select('*')
      .eq('is_active', true)
      .limit(1);
    const fallbackAgentProfileId = Array.isArray(settings)
      ? settings[0]?.fallback_agent_profile_id || null
      : null;
    if (fallbackAgentProfileId) {
      return {
        assignedAgentProfileId: fallbackAgentProfileId,
        strategy: 'fallback',
        path: 'engine_settings_fallback',
        wouldInvokeRpc: false,
      };
    }
    return {
      assignedAgentProfileId: null,
      strategy: 'assignment_engine',
      path: 'engine_rpc',
      wouldInvokeRpc: true,
    };
  }

  return {
    assignedAgentProfileId: null,
    strategy: 'assignment_engine',
    path: 'engine_rpc',
    wouldInvokeRpc: true,
  };
}

/**
 * @param {object} input
 * @param {{ supabase?: object, logger?: object }} deps
 */
async function resolveAssignmentDecision(input, deps = {}) {
  const {
    buildAssignmentPriorityCandidates,
    shouldTriggerHandoff,
    isDemandLeadContext,
  } = leadAutomationShared();
  const logger = deps.logger || console;
  const previewMode = input.mode === 'preview';
  const lead = input.lead || {};
  const aiState = input.aiState || {};
  const leadType = input.leadType;
  const contactOwner = input.contactOwner || {};
  const propertyId = input.propertyId || null;

  const candidates = buildAssignmentPriorityCandidates(
    {
      leadId: lead.id || input.leadId || null,
      conversationId: input.conversationId || null,
      leadType,
      aiState,
      property: input.property,
      propertyId,
      campaignAgentProfileId: input.campaignAgentProfileId || null,
      contactAssignedAgentProfileId: contactOwner.assignedAgentProfileId || null,
      conversationAssignedAgentProfileId: input.conversationAssignedAgentProfileId || null,
      contactWasCreated: input.contactWasCreated === true,
    },
    logger,
  ).map((c, index) => ({ ...c, rank: index + 1 }));

  if (lead.assigned_agent_profile_id) {
    return {
      willAssign: false,
      path: 'skip_already_assigned',
      assignedAgentProfileId: lead.assigned_agent_profile_id,
      strategy: lead.assignment_source || 'already_assigned',
      reason: 'lead_already_has_agent',
      candidates,
      handoffTriggered: false,
      wouldInvokeRpc: false,
    };
  }

  const demandContactOwnerPriority =
    isDemandLeadContext(leadType, aiState) && !!contactOwner.assignedAgentProfileId;

  if (demandContactOwnerPriority) {
    return {
      willAssign: true,
      path: 'contact_owner_bypass',
      assignedAgentProfileId: contactOwner.assignedAgentProfileId,
      strategy: 'contact_owner',
      reason: 'demand_contact_owner_priority',
      candidates,
      handoffTriggered: true,
      wouldInvokeRpc: false,
    };
  }

  const handoffCandidate = buildHandoffCandidate(lead, aiState, propertyId);
  const handoffTriggered = shouldTriggerHandoff(handoffCandidate);

  if (!handoffTriggered) {
    return {
      willAssign: false,
      path: 'deferred_not_ready_for_handoff',
      assignedAgentProfileId: null,
      strategy: null,
      reason: 'lead_not_ready_for_handoff',
      candidates,
      handoffTriggered: false,
      wouldInvokeRpc: false,
    };
  }

  if (aiState.legal_sensitive) {
    return {
      willAssign: false,
      path: 'deferred_legal_sensitive',
      assignedAgentProfileId: null,
      strategy: null,
      reason: 'legal_sensitive_review_required',
      candidates,
      handoffTriggered: true,
      wouldInvokeRpc: false,
    };
  }

  for (const candidate of candidates) {
    if (candidate.agentId) {
      return {
        willAssign: true,
        path: 'priority_candidate',
        assignedAgentProfileId: candidate.agentId,
        strategy: candidate.strategy,
        reason: candidate.reason,
        candidates,
        handoffTriggered: true,
        wouldInvokeRpc: false,
      };
    }
  }

  const engine = await resolveEngineAssignmentReadOnly(
    deps.supabase,
    {
      leadType,
      aiState,
      property: input.property,
      propertyId,
      operationType: input.operationType || aiState?.operation_type || null,
      propertyType: input.propertyType || aiState?.property_type || null,
      budgetMin: input.budgetMin ?? aiState?.budget_min ?? null,
      budgetMax: input.budgetMax ?? aiState?.budget_max ?? null,
    },
    { previewMode, logger },
  );

  return {
    willAssign: !!engine.assignedAgentProfileId,
    path: engine.path,
    assignedAgentProfileId: engine.assignedAgentProfileId,
    strategy: engine.strategy,
    reason: engine.path,
    candidates,
    handoffTriggered: true,
    wouldInvokeRpc: engine.wouldInvokeRpc === true,
  };
}

module.exports = {
  resolveAssignmentDecision,
  resolveEngineAssignmentReadOnly,
  buildHandoffCandidate,
  ruleMatchesContext,
};
