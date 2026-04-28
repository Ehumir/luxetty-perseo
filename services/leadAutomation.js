const { nowIso, normalizePhoneNumber } = require('../utils/helpers');
const { normalizeText } = require('../utils/text');

function log(logger, label, payload = {}) {
  const writer = logger && typeof logger.info === 'function' ? logger.info.bind(logger) : console.log;
  writer(label, payload);
}

function logWarn(logger, label, payload = {}) {
  const writer = logger && typeof logger.warn === 'function' ? logger.warn.bind(logger) : console.warn;
  writer(label, payload);
}

async function saveConversationEvent(supabase, conversationId, type, payload = {}) {
  if (!supabase || !conversationId || !type) return;

  const { error } = await supabase.from('conversation_events').insert({
    conversation_id: conversationId,
    type,
    payload,
  });

  if (error) {
    console.error('LEAD_AUTOMATION_EVENT_ERROR', { type, error: error.message });
  }
}

function resolveLeadType(aiState = {}) {
  if (aiState.lead_type === 'supply' || aiState.lead_type === 'demand') return aiState.lead_type;
  if (aiState.lead_flow === 'offer') return 'supply';
  if (aiState.lead_flow === 'demand') return 'demand';
  if (aiState.direct_property_reference || aiState.property_code || aiState.direct_property_code) return 'demand';

  const goal = normalizeText(aiState.user_goal || '');
  if (goal.includes('capture')) return 'supply';
  if (goal.includes('search')) return 'demand';

  return null;
}

function sameNullableValue(left, right) {
  return (left || null) === (right || null);
}

function isLeadCompatible(lead, { contactId, leadType, operation, propertyId }) {
  if (!lead) return false;
  if (!sameNullableValue(lead.contact_id, contactId)) return false;
  if (!sameNullableValue(lead.lead_type, leadType)) return false;
  if (!sameNullableValue(lead.interested_in_operation, operation || null)) return false;
  if (!sameNullableValue(lead.interested_property_id, propertyId || null)) return false;
  if (lead.is_active === false || lead.is_archived === true) return false;
  return true;
}

function buildResetAiStateAfterLeadCreated(aiState = {}, lead, assignment = {}) {
  return {
    lead_flow: null,
    operation_type: null,
    property_type: null,
    location_text: null,
    matched_location_from_catalog: null,
    location_any: false,
    budget_min: null,
    budget_max: null,
    budget_currency: null,
    bedrooms: null,
    bedrooms_any: false,
    bathrooms: null,
    must_have_features: [],
    timeline_text: null,
    urgency_level: null,
    full_name: aiState.full_name || null,
    owner_relation: null,
    contact_preference: aiState.contact_preference || null,
    contact_number_confirmed: aiState.contact_number_confirmed ?? null,
    awaiting_field: null,
    last_change_type: 'context_reset_after_lead_created',
    intent_version: (aiState.intent_version || 1) + 1,
    needs_fresh_search: false,
    last_search_filters: null,
    last_search_result_count: 0,
    last_shown_property_ids: [],
    wants_human: false,
    user_goal: null,
    confidence: 'low',
    geo_qualified: null,
    value_qualified: null,
    capture_qualified: null,
    handoff_ready: false,
    handoff_sent: false,
    closing_message_sent: false,
    lead_id: lead.id,
    assigned_agent_profile_id:
      assignment.assignedAgentProfileId || lead.assigned_agent_profile_id || null,
    last_completed_lead: {
      lead_id: lead.id,
      lead_type: lead.lead_type || null,
      interested_in_operation: lead.interested_in_operation || null,
      interested_property_id: lead.interested_property_id || null,
      completed_at: nowIso(),
    },
    ai_context_reset_after_lead_created_at: nowIso(),
  };
}

function resolveOperation(aiState = {}, property = null) {
  const propertyOperation = property?.operation_type || null;
  const stateOperation = aiState.operation_type || aiState.interested_in_operation || null;
  const operation = propertyOperation || stateOperation;

  if (operation === 'sale' || operation === 'rent') return operation;
  return null;
}

function hasCommercialContext(aiState = {}, propertyId = null) {
  if (propertyId) return true;
  if (aiState.direct_property_reference && (aiState.property_code || aiState.direct_property_code)) return false;

  return Boolean(
    aiState.location_text ||
      aiState.location_any ||
      aiState.property_type ||
      aiState.budget_min != null ||
      aiState.budget_max != null ||
      aiState.wants_visit ||
      aiState.asks_property_details ||
      aiState.wants_human ||
      aiState.shows_high_interest
  );
}

function hasClearIntent(aiState = {}, propertyId = null) {
  const leadType = resolveLeadType(aiState);
  if (!leadType) return false;

  if (propertyId) return true;
  if (leadType === 'supply') return hasCommercialContext(aiState, propertyId);

  if (aiState.shows_high_interest && !aiState.property_type && !aiState.location_text && !aiState.budget_max) {
    return false;
  }

  return hasCommercialContext(aiState, propertyId);
}

function buildNotesSummary(aiState = {}, property = null) {
  const parts = [];
  const leadType = resolveLeadType(aiState);
  const operation = resolveOperation(aiState, property);

  if (leadType === 'supply') {
    parts.push(`Solicitud de oferta para ${operation === 'rent' ? 'poner en renta' : 'vender'} propiedad.`);
  } else {
    parts.push(`Solicitud de demanda para ${operation === 'rent' ? 'rentar' : 'comprar'} propiedad.`);
  }

  if (property?.listing_id) parts.push(`Propiedad: ${property.listing_id}.`);
  if (aiState.property_code) parts.push(`Codigo mencionado: ${aiState.property_code}.`);
  if (aiState.property_type) parts.push(`Tipo: ${aiState.property_type}.`);
  if (aiState.location_text) parts.push(`Zona: ${aiState.location_text}.`);
  if (aiState.budget_max != null) parts.push(`Presupuesto max: ${aiState.budget_max} ${aiState.budget_currency || 'MXN'}.`);
  if (aiState.wants_visit) parts.push('Quiere visita.');
  if (aiState.asks_property_details) parts.push('Pidio detalles.');
  if (aiState.wants_human) parts.push('Pidio asesor humano.');

  return parts.filter(Boolean).join(' ').slice(0, 1500);
}

async function getInitialPipelineStageId(supabase, leadType) {
  if (!supabase || !leadType) return null;

  let result = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('code', 'new')
    .eq('lead_type', leadType)
    .eq('is_active', true)
    .order('stage_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!result.error && result.data?.id) return result.data.id;

  result = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('code', 'new')
    .is('lead_type', null)
    .eq('is_active', true)
    .order('stage_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  return result.data?.id || null;
}

async function findLeadByConversation(supabase, leadId) {
  if (!leadId) return null;
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .maybeSingle();

  if (error) {
    console.error('LEAD_AUTOMATION_FIND_BY_CONVERSATION_ERROR', { error: error.message });
    return null;
  }

  return data || null;
}

async function findCompatibleLead(supabase, { contactId, leadType, operation, propertyId }) {
  let query = supabase
    .from('leads')
    .select('*')
    .eq('contact_id', contactId)
    .eq('lead_type', leadType)
    .order('created_at', { ascending: false })
    .limit(1);

  if (operation) query = query.eq('interested_in_operation', operation);
  else query = query.is('interested_in_operation', null);
  if (propertyId) query = query.eq('interested_property_id', propertyId);
  else query = query.is('interested_property_id', null);

  query = query.eq('is_active', true).eq('is_archived', false);

  const { data, error } = await query;
  if (error) {
    console.error('LEAD_AUTOMATION_FIND_COMPATIBLE_ERROR', { error: error.message });
    return null;
  }

  return data?.[0] || null;
}

async function insertLeadWithSourceFallback(supabase, payload) {
  const { data, error } = await supabase
    .from('leads')
    .insert(payload)
    .select()
    .single();

  if (!error) return { data, error: null };

  const looksLikeSourceEnumError =
    String(error.message || '').includes('lead_source') ||
    String(error.message || '').includes('invalid input value for enum') ||
    String(error.message || '').includes('source');

  if (payload.source === 'whatsapp' && looksLikeSourceEnumError) {
    const fallbackPayload = { ...payload, source: 'manual' };
    return supabase.from('leads').insert(fallbackPayload).select().single();
  }

  return { data: null, error };
}

async function syncConversation(supabase, conversationId, payload) {
  if (!conversationId) return;
  const { error } = await supabase
    .from('conversations')
    .update({
      ...payload,
      updated_at: nowIso(),
    })
    .eq('id', conversationId);

  if (error) console.error('LEAD_AUTOMATION_CONVERSATION_SYNC_ERROR', { error: error.message });
}

async function assignLead(supabase, leadId, conversationId, logger) {
  await saveConversationEvent(supabase, conversationId, 'lead_assignment_attempted', {
    lead_id: leadId,
    source: 'ai_agent',
  });

  const { data, error } = await supabase.rpc('assign_lead_via_engine', {
    p_lead_id: leadId,
    p_triggered_by: null,
  });

  if (error) {
    logWarn(logger, 'LEAD_AUTOMATION_ASSIGNMENT_FAILED', { lead_id: leadId, error: error.message });
    await saveConversationEvent(supabase, conversationId, 'lead_assignment_failed', {
      lead_id: leadId,
      reason: 'assignment_rpc_error',
      error: error.message,
    });
    return {
      assignedAgentProfileId: null,
      assignmentResult: { success: false, reason: 'assignment_rpc_error', error: error.message },
    };
  }

  const assignedAgentProfileId =
    data?.assigned_agent_profile_id ||
    data?.suggested_agent_profile_id ||
    null;

  if (assignedAgentProfileId) {
    log(logger, 'LEAD_AUTOMATION_ASSIGNED', {
      lead_id: leadId,
      assigned_agent_profile_id: assignedAgentProfileId,
      strategy: data?.strategy || null,
      reason: data?.reason || null,
    });
    await saveConversationEvent(supabase, conversationId, 'lead_assigned', {
      lead_id: leadId,
      assigned_agent_profile_id: assignedAgentProfileId,
      strategy: data?.strategy || null,
      reason: data?.reason || null,
      source: 'ai_agent',
    });
  } else {
    logWarn(logger, 'LEAD_AUTOMATION_ASSIGNMENT_FAILED', {
      lead_id: leadId,
      reason: data?.reason || 'no_assignment_match',
    });
    await saveConversationEvent(supabase, conversationId, 'lead_assignment_failed', {
      lead_id: leadId,
      reason: data?.reason || 'no_assignment_match',
      strategy: data?.strategy || null,
      source: 'ai_agent',
    });
  }

  return { assignedAgentProfileId, assignmentResult: data };
}

async function createOrReuseLeadFromConversation({
  supabase,
  conversation,
  aiState,
  contactId,
  propertyId,
  property = null,
  logger,
}) {
  const conversationId = conversation?.id || null;

  try {
    log(logger, 'LEAD_AUTOMATION_START', {
      conversation_id: conversationId,
      contact_id: contactId || null,
      property_id: propertyId || null,
    });

    if (!contactId) {
      logWarn(logger, 'LEAD_AUTOMATION_SKIPPED_MISSING_CONTACT', { conversation_id: conversationId });
      await saveConversationEvent(supabase, conversationId, 'lead_not_created_missing_contact', {
        reason: 'missing_contact',
      });
      return {
        success: false,
        lead: null,
        leadId: null,
        wasCreated: false,
        assignedAgentProfileId: null,
        assignmentResult: null,
        reason: 'missing_contact',
      };
    }

    if (aiState?.direct_property_reference && (aiState.property_code || aiState.direct_property_code) && !propertyId) {
      logWarn(logger, 'LEAD_AUTOMATION_SKIPPED_MISSING_PROPERTY', {
        conversation_id: conversationId,
        property_code: aiState.property_code || aiState.direct_property_code,
      });
      await saveConversationEvent(supabase, conversationId, 'lead_not_created_missing_property', {
        property_code: aiState.property_code || aiState.direct_property_code,
        reason: 'missing_property',
      });
      return {
        success: false,
        lead: null,
        leadId: null,
        wasCreated: false,
        assignedAgentProfileId: null,
        assignmentResult: null,
        reason: 'missing_property',
      };
    }

    if (!hasClearIntent(aiState, propertyId)) {
      log(logger, 'LEAD_AUTOMATION_SKIPPED_LOW_CONFIDENCE', {
        conversation_id: conversationId,
        lead_flow: aiState?.lead_flow || null,
        confidence: aiState?.confidence || null,
      });
      await saveConversationEvent(supabase, conversationId, 'lead_not_created_low_confidence', {
        lead_flow: aiState?.lead_flow || null,
        confidence: aiState?.confidence || null,
        reason: 'low_confidence_or_ambiguous_intent',
      });
      return {
        success: false,
        lead: null,
        leadId: null,
        wasCreated: false,
        assignedAgentProfileId: null,
        assignmentResult: null,
        reason: 'low_confidence',
      };
    }

    const leadType = resolveLeadType(aiState);
    const operation = resolveOperation(aiState, property);
    const expected = {
      contactId,
      leadType,
      operation,
      propertyId: propertyId || null,
    };

    await saveConversationEvent(supabase, conversationId, 'lead_intent_detected', {
      lead_type: leadType,
      interested_in_operation: operation,
      interested_property_id: propertyId || null,
      source: 'ai_agent',
    });

    await saveConversationEvent(
      supabase,
      conversationId,
      leadType === 'supply' ? 'lead_type_detected_supply' : 'lead_type_detected_demand',
      {
        lead_type: leadType,
        interested_in_operation: operation,
        interested_property_id: propertyId || null,
        source: 'ai_agent',
      }
    );

    let lead = await findLeadByConversation(supabase, conversation?.lead_id || aiState?.lead_id || null);
    let wasCreated = false;
    let intentChanged = false;

    if (lead) {
      if (isLeadCompatible(lead, expected)) {
        log(logger, 'LEAD_AUTOMATION_REUSE_BY_CONVERSATION', {
          conversation_id: conversationId,
          lead_id: lead.id,
        });
        await saveConversationEvent(supabase, conversationId, 'lead_reused', {
          lead_id: lead.id,
          reason: 'conversation_lead_id',
          source: 'ai_agent',
        });
      } else {
        intentChanged = true;
        await saveConversationEvent(supabase, conversationId, 'lead_intent_changed', {
          previous_lead_id: lead.id,
          previous_lead_type: lead.lead_type || null,
          previous_interested_in_operation: lead.interested_in_operation || null,
          previous_interested_property_id: lead.interested_property_id || null,
          next_lead_type: leadType,
          next_interested_in_operation: operation,
          next_interested_property_id: propertyId || null,
          source: 'ai_agent',
        });
        lead = null;
      }
    }

    if (!lead) {
      lead = await findCompatibleLead(supabase, {
        contactId,
        leadType,
        operation,
        propertyId: propertyId || null,
      });

      if (lead) {
        log(logger, 'LEAD_AUTOMATION_REUSE_BY_MATCH', {
          conversation_id: conversationId,
          lead_id: lead.id,
        });
        await saveConversationEvent(supabase, conversationId, 'lead_reused', {
          lead_id: lead.id,
          reason: 'compatible_active_lead',
          source: 'ai_agent',
        });
      }
    }

    if (!lead) {
      const pipelineStageId = await getInitialPipelineStageId(supabase, leadType);
      const notesSummary = buildNotesSummary(aiState, property);

      const normalizedConversationPhone = normalizePhoneNumber(conversation?.phone) || conversation?.phone || null;
      const payload = {
        contact_id: contactId,
        lead_type: leadType,
        source: 'whatsapp',
        interested_property_id: propertyId || null,
        interested_in_operation: operation,
        notes_summary: notesSummary || null,
        budget_min: aiState?.budget_min != null ? Number(aiState.budget_min) : null,
        budget_max: aiState?.budget_max != null ? Number(aiState.budget_max) : null,
        preferred_zones: aiState?.location_text ? [String(aiState.location_text)] : null,
        pipeline_stage_id: pipelineStageId,
        status: 'new',
        is_active: true,
        is_archived: false,
        phone: normalizedConversationPhone,
        whatsapp: conversation?.channel === 'whatsapp' ? normalizedConversationPhone : null,
        next_action: leadType === 'supply' ? 'Contactar propietario' : 'Contactar lead',
        next_action_due_at: nowIso(),
      };

      const { data, error } = await insertLeadWithSourceFallback(supabase, payload);
      if (error || !data) {
        throw new Error(error?.message || 'lead_insert_failed');
      }

      lead = data;
      wasCreated = true;
      log(logger, 'LEAD_AUTOMATION_CREATED', {
        conversation_id: conversationId,
        lead_id: lead.id,
      });
      await saveConversationEvent(supabase, conversationId, 'lead_created', {
        lead_id: lead.id,
        lead_type: leadType,
        interested_in_operation: operation,
        interested_property_id: propertyId || null,
        source: 'ai_agent',
      });

      if (intentChanged) {
        await saveConversationEvent(supabase, conversationId, 'new_lead_created_due_to_intent_change', {
          lead_id: lead.id,
          lead_type: leadType,
          interested_in_operation: operation,
          interested_property_id: propertyId || null,
          source: 'ai_agent',
        });
      }
    }

    const { assignedAgentProfileId, assignmentResult } = await assignLead(
      supabase,
      lead.id,
      conversationId,
      logger
    );

    let nextAiState;

    if (wasCreated) {
      nextAiState = buildResetAiStateAfterLeadCreated(aiState, lead, {
        assignedAgentProfileId,
      });
      await saveConversationEvent(supabase, conversationId, 'ai_context_reset_after_lead_created', {
        lead_id: lead.id,
        lead_type: lead.lead_type || leadType,
        interested_in_operation: lead.interested_in_operation || operation,
        interested_property_id: lead.interested_property_id || propertyId || null,
        source: 'ai_agent',
      });
    } else {
      nextAiState = {
        ...(aiState || {}),
        lead_id: lead.id,
        lead_type: lead.lead_type || leadType,
        interested_in_operation: lead.interested_in_operation || operation,
        interested_property_id: lead.interested_property_id || propertyId || null,
        crm_lead_created_at: aiState?.crm_lead_created_at || nowIso(),
      };
    }

    if (assignedAgentProfileId) {
      nextAiState.assigned_agent_profile_id = assignedAgentProfileId;
    }

    await syncConversation(supabase, conversationId, {
      lead_id: lead.id,
      contact_id: contactId,
      assigned_agent_profile_id: assignedAgentProfileId || lead.assigned_agent_profile_id || null,
      ai_state: nextAiState,
    });

    return {
      success: true,
      lead,
      leadId: lead.id,
      wasCreated,
      assignedAgentProfileId: assignedAgentProfileId || lead.assigned_agent_profile_id || null,
      assignmentResult,
      reason: wasCreated ? 'lead_created' : 'lead_reused',
      aiState: nextAiState,
    };
  } catch (err) {
    logWarn(logger, 'LEAD_AUTOMATION_ERROR', {
      conversation_id: conversationId,
      error: err?.message || String(err),
    });
    await saveConversationEvent(supabase, conversationId, 'lead_assignment_failed', {
      reason: 'lead_automation_error',
      error: err?.message || String(err),
      source: 'ai_agent',
    });

    return {
      success: false,
      lead: null,
      leadId: null,
      wasCreated: false,
      assignedAgentProfileId: null,
      assignmentResult: null,
      reason: 'lead_automation_error',
      error: err?.message || String(err),
    };
  }
}

module.exports = {
  createOrReuseLeadFromConversation,
};
