const { nowIso } = require('../utils/helpers');
const { normalizeText } = require('../utils/text');

function asValidOperationType(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'sale' || normalized === 'rent') return normalized;
  return null;
}

function asPreferredZones(state = {}) {
  if (!state || !state.location_text) return null;
  const text = String(state.location_text).trim();
  return text ? [text] : null;
}

function hasDemandIntentSignals(state = {}, messageText = '') {
  const normalized = normalizeText(messageText || '');

  if (state.wants_visit || state.shows_high_interest || state.asks_property_details || state.wants_human) {
    return true;
  }

  if (state.location_text || state.budget_min || state.budget_max || state.property_type) {
    return true;
  }

  return (
    normalized.includes('busco') ||
    normalized.includes('quiero comprar') ||
    normalized.includes('comprar') ||
    normalized.includes('quiero rentar') ||
    normalized.includes('rentar') ||
    normalized.includes('renta')
  );
}

function resolveOperationType(mode, params = {}) {
  const stateOp = asValidOperationType(params?.state?.operation_type);

  if (mode === 'demand_internal') {
    return asValidOperationType(params?.property?.operation_type) || stateOp;
  }

  return stateOp;
}

function resolveAssignedAgentProfileId(params = {}) {
  return (
    params.assignedAgentProfileId ||
    params?.conversationRow?.assigned_agent_profile_id ||
    params?.state?.assigned_agent_profile_id ||
    null
  );
}

function buildRequestTitle(mode, params = {}) {
  const state = params.state || {};
  const property = params.property || null;

  if (mode === 'demand_internal') {
    if (property?.listing_id && property?.title) {
      return `Demanda directa ${property.listing_id} - ${property.title}`;
    }
    if (property?.listing_id) {
      return `Demanda directa ${property.listing_id}`;
    }
    return 'Demanda directa sobre propiedad';
  }

  if (mode === 'offer') {
    const operationType = resolveOperationType(mode, params) || 'sale';
    const titleParts = ['Captacion'];
    titleParts.push(operationType === 'rent' ? 'renta' : 'venta');
    if (state.property_type) titleParts.push(state.property_type);
    if (state.location_text) titleParts.push(`en ${state.location_text}`);
    return titleParts.join(' ');
  }

  const titleParts = ['Demanda'];
  titleParts.push((resolveOperationType(mode, params) || 'sale') === 'rent' ? 'renta' : 'compra');
  if (state.property_type) titleParts.push(state.property_type);
  if (state.location_text) titleParts.push(`en ${state.location_text}`);
  return titleParts.join(' ');
}

function buildNotesSummary(mode, params = {}) {
  const summary = params.buildSummary ? params.buildSummary() : null;
  if (summary) return summary;

  if (mode === 'offer') {
    return 'Cliente quiere vender o poner en renta una propiedad y requiere seguimiento comercial.';
  }

  if (mode === 'demand_internal') {
    return 'Cliente entro por referencia directa de propiedad y requiere seguimiento comercial.';
  }

  return 'Cliente buscando propiedad y requiere seguimiento comercial.';
}

function buildDiscoveryNotes(mode, params = {}) {
  const state = params.state || {};
  const hints = [];

  if (state.location_text) hints.push(`zona:${state.location_text}`);
  if (state.property_type) hints.push(`tipo:${state.property_type}`);
  if (state.direct_property_code) hints.push(`codigo:${state.direct_property_code}`);
  if (state.property_code) hints.push(`codigo:${state.property_code}`);
  if (state.owner_relation && mode === 'offer') hints.push(`relacion:${state.owner_relation}`);

  return hints.length ? hints.join(' | ') : null;
}

function buildNextAction(mode, params = {}) {
  const state = params.state || {};
  if (mode === 'offer') return 'Contactar propietario';
  if (state.wants_visit) return mode === 'demand_internal' ? 'Coordinar visita' : 'Contactar para coordinar visita';
  return 'Contactar lead';
}

function determineRequestCreationMode(params = {}) {
  const state = params.state || {};
  const property = params.property || null;
  const messageText = params.messageText || '';

  if (state.lead_flow === 'offer') return 'offer';

  if (property?.id) return 'demand_internal';

  if (state.lead_flow === 'demand') {
    if (state.direct_property_reference && (state.property_code || state.direct_property_code) && !property?.id) {
      return null;
    }
    if (hasDemandIntentSignals(state, messageText)) return 'demand_external';
  }

  return null;
}

function hasMinimumDataForRequest(mode, params = {}) {
  const state = params.state || {};
  const contactId = params.contactId || params?.conversationRow?.contact_id || null;
  const operationType = resolveOperationType(mode, params);

  if (!contactId) return false;

  if (mode === 'offer') {
    const hasContext = !!state.location_text || !!state.property_type || !!state.property_code || !!state.direct_property_reference;
    return !!operationType && hasContext;
  }

  if (mode === 'demand_internal') {
    return !!params?.property?.id && !!operationType;
  }

  if (mode === 'demand_external') {
    const hasContext =
      state.budget_min != null ||
      state.budget_max != null ||
      !!state.location_text ||
      !!state.property_type ||
      !!state.wants_visit ||
      !!state.shows_high_interest ||
      !!state.asks_property_details;
    return !!operationType && hasContext;
  }

  return false;
}

async function findExistingEquivalentRequest(params = {}) {
  const { supabase, mode, conversationId, contactId, property } = params;

  if (!supabase || !mode || !conversationId || !contactId) return null;

  let query = supabase
    .from('requests')
    .select('id, request_type, operation_type, contact_id, conversation_id, property_id, stage_id, assigned_agent_profile_id, is_active, created_at')
    .eq('conversation_id', conversationId)
    .eq('contact_id', contactId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1);

  if (mode === 'offer') {
    query = query.eq('request_type', 'offer');
  } else if (mode === 'demand_internal') {
    if (!property?.id) return null;
    query = query.eq('request_type', 'demand').eq('property_id', property.id);
  } else if (mode === 'demand_external') {
    query = query.eq('request_type', 'demand').is('property_id', null);
  } else {
    return null;
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error checking existing equivalent request:', error);
    return null;
  }

  return data?.[0] || null;
}

function classifyAssignmentOutcome(assignment = {}) {
  if (assignment.success && assignment.assigned_agent_profile_id) {
    return 'assigned';
  }
  if (assignment.success === false && assignment.reason === 'manual_review') {
    return 'manual_review';
  }
  if (assignment.success === false && assignment.reason === 'no_agent_resolved') {
    return 'no_agent';
  }
  if (assignment.reason === 'rpc_error') {
    return 'rpc_error';
  }
  if (assignment.reason === 'invalid_request') {
    return 'invalid_request';
  }
  if (assignment.success === false) {
    return 'rpc_error';
  }
  return 'unknown';
}

async function assignRequestViaEngine({
  supabase,
  request,
  conversationId,
}) {
  if (!supabase || !request?.id) {
    const result = {
      success: false,
      assigned_agent_profile_id: null,
      assigned_user_id: null,
      strategy: null,
      reason: 'invalid_request',
      raw: null,
    };
    result.outcome = classifyAssignmentOutcome(result);
    return result;
  }

  try {
    const { data, error } = await supabase.rpc('assign_from_external_trigger', {
      p_request_id: request.id,
      p_conversation_id: conversationId ?? null,
      p_source: 'ai_agent',
    });

    if (error) {
      const result = {
        success: false,
        assigned_agent_profile_id: null,
        assigned_user_id: null,
        strategy: null,
        reason: 'rpc_error',
        error,
        raw: null,
      };
      result.outcome = classifyAssignmentOutcome(result);
      return result;
    }

    const result = {
      success: data?.success === true,
      assigned_agent_profile_id: data?.assigned_agent_profile_id ?? null,
      assigned_user_id: data?.assigned_user_id ?? null,
      strategy: data?.strategy ?? null,
      reason: data?.reason ?? null,
      raw: data ?? null,
    };
    result.outcome = classifyAssignmentOutcome(result);
    return result;
  } catch (err) {
    const result = {
      success: false,
      assigned_agent_profile_id: null,
      assigned_user_id: null,
      strategy: null,
      reason: 'rpc_error',
      error: err,
      raw: null,
    };
    result.outcome = classifyAssignmentOutcome(result);
    return result;
  }
}

async function getInitialRequestStageId(supabase, requestType = 'demand') {
  if (!supabase) return null;

  try {
    let query = supabase
      .from('request_stages')
      .select('id, code, stage_order')
      .eq('request_type', requestType)
      .eq('code', 'new')
      .eq('is_active', true)
      .order('stage_order', { ascending: true })
      .limit(1);

    let { data, error } = await query;

    if (error) {
      const fallback = await supabase
        .from('request_stages')
        .select('id, code, stage_order')
        .eq('request_type', requestType)
        .eq('code', 'new')
        .order('stage_order', { ascending: true })
        .limit(1);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('Error getting initial request stage:', error);
      return null;
    }

    return data?.[0]?.id || null;
  } catch (err) {
    console.error('FATAL getInitialRequestStageId:', err);
    return null;
  }
}

async function buildRequestPayload(params = {}) {
  const {
    supabase,
    mode,
    state,
    property,
    conversationId,
    contactId,
    assignedAgentProfileId,
  } = params;

  const requestType = mode === 'offer' ? 'offer' : 'demand';
  const operationType = resolveOperationType(mode, { state, property }) || 'sale';
  const stageId = await getInitialRequestStageId(supabase, requestType);

  return {
    request_type: requestType,
    operation_type: operationType,
    status: 'open',
    contact_id: contactId,
    assigned_agent_profile_id: null,
    created_by: null,
    source: 'ai_agent',
    property_id: mode === 'demand_internal' ? property?.id || null : null,
    zone_id: property?.zone_id || null,
    conversation_id: conversationId,
    stage_id: stageId,
    title: buildRequestTitle(mode, params),
    discovery_notes: buildDiscoveryNotes(mode, params),
    notes_summary: buildNotesSummary(mode, params),
    budget_min: state?.budget_min != null ? Number(state.budget_min) : null,
    budget_max: state?.budget_max != null ? Number(state.budget_max) : null,
    preferred_zones: asPreferredZones(state),
    next_action: buildNextAction(mode, { state }),
    next_action_due_at: nowIso(),
    is_active: true,
  };
}

async function createRequestIfNeeded(params = {}) {
  const {
    supabase,
    conversationId,
    conversationRow,
    state,
    contactId,
    property,
    messageText,
    assignedAgentProfileId,
    saveConversationEvent,
  } = params;

  const mode = determineRequestCreationMode({ state, property, messageText });

  if (!mode) {
    return {
      created: false,
      mode: null,
      request: null,
      reason: 'mode_not_detected',
    };
  }

  const effectiveContactId = contactId || conversationRow?.contact_id || null;
  const effectiveAssignedAgentProfileId =
    assignedAgentProfileId || resolveAssignedAgentProfileId({ conversationRow, state });

  const minimumOk = hasMinimumDataForRequest(mode, {
    state,
    property,
    contactId: effectiveContactId,
    conversationRow,
  });

  if (!minimumOk) {
    if (conversationId && saveConversationEvent) {
      await saveConversationEvent(conversationId, 'request_not_ready', {
        mode,
        request_id: null,
        property_id: property?.id || null,
        operation_type: resolveOperationType(mode, { state, property }),
        reason: 'insufficient_data',
      });
    }
    return {
      created: false,
      mode,
      request: null,
      reason: 'insufficient_data',
    };
  }

  if (conversationId && saveConversationEvent) {
    await saveConversationEvent(conversationId, 'request_detected', {
      mode,
      request_id: null,
      property_id: property?.id || null,
      operation_type: resolveOperationType(mode, { state, property }),
      reason: 'mode_detected',
    });
  }

  try {
    const existing = await findExistingEquivalentRequest({
      supabase,
      mode,
      conversationId,
      contactId: effectiveContactId,
      property,
    });

    if (existing) {
      if (conversationId && saveConversationEvent) {
        await saveConversationEvent(conversationId, 'request_existing_found', {
          mode,
          request_id: existing.id,
          property_id: existing.property_id || property?.id || null,
          operation_type: existing.operation_type || null,
          reason: 'existing_request_found',
        });
      }

      return {
        created: false,
        mode,
        request: existing,
        reason: 'existing_request_found',
      };
    }

    const payload = await buildRequestPayload({
      supabase,
      mode,
      state,
      property,
      conversationId,
      contactId: effectiveContactId,
      conversationRow,
      assignedAgentProfileId: effectiveAssignedAgentProfileId,
      buildSummary: params.buildSummary,
    });

    const { data: created, error: createError } = await supabase
      .from('requests')
      .insert(payload)
      .select()
      .single();

    if (createError || !created) {
      if (conversationId && saveConversationEvent) {
        await saveConversationEvent(conversationId, 'request_creation_failed', {
          mode,
          request_id: null,
          property_id: payload.property_id || null,
          operation_type: payload.operation_type || null,
          reason: 'request_creation_failed',
        });
      }

      if (createError) {
        console.error('Error creating request:', createError);
      }

      return {
        created: false,
        mode,
        request: null,
        reason: 'request_creation_failed',
      };
    }

    if (conversationId && saveConversationEvent) {
      await saveConversationEvent(conversationId, 'request_created', {
        mode,
        request_id: created.id,
        property_id: created.property_id || property?.id || null,
        operation_type: created.operation_type || payload.operation_type,
        reason: 'request_created',
      });
    }

    return {
      created: true,
      mode,
      request: created,
      reason: 'request_created',
    };
  } catch (err) {
    console.error('FATAL createRequestIfNeeded:', err);

    if (conversationId && saveConversationEvent) {
      await saveConversationEvent(conversationId, 'request_creation_failed', {
        mode,
        request_id: null,
        property_id: property?.id || null,
        operation_type: resolveOperationType(mode, { state, property }),
        reason: 'request_creation_failed',
      });
    }

    return {
      created: false,
      mode,
      request: null,
      reason: 'request_creation_failed',
    };
  }
}

module.exports = {
  determineRequestCreationMode,
  hasMinimumDataForRequest,
  findExistingEquivalentRequest,
  getInitialRequestStageId,
  buildRequestPayload,
  createRequestIfNeeded,
  assignRequestViaEngine,
};
