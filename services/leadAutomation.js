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

function clampLeadScore(score) {
  return Math.max(0, Math.min(100, Number(score) || 0));
}

function getLeadTemperature(score) {
  if (score <= 40) return 'cold';
  if (score <= 70) return 'warm';
  return 'hot';
}

function hasAmbiguousIntent(aiState = {}, intent = {}) {
  const confidence = normalizeText(aiState.confidence || intent.confidence || '');
  const leadType = intent.leadType || intent.lead_type || aiState.lead_type || resolveLeadType(aiState);

  if (!leadType) return true;

  if (
    confidence === 'low' &&
    !aiState.budget_max &&
    !aiState.location_text &&
    !aiState.property_code &&
    !aiState.direct_property_code
  ) {
    return true;
  }

  return false;
}

function calculateLeadScore({ aiState = {}, intent = {} } = {}) {
  let score = 0;

  if (aiState.budget_min != null || aiState.budget_max != null || intent.budget_min != null || intent.budget_max != null) {
    score += 30;
  }

  if (aiState.location_text || aiState.matched_location_from_catalog || intent.location_text) {
    score += 20;
  }

  if (
    aiState.property_code ||
    aiState.direct_property_code ||
    aiState.direct_property_reference ||
    intent.property_code ||
    intent.direct_property_reference
  ) {
    score += 30;
  }

  if (
    aiState.wants_visit ||
    aiState.wants_human ||
    aiState.asks_property_details ||
    intent.wants_visit ||
    intent.wants_human ||
    intent.asks_property_details
  ) {
    score += 20;
  }

  if (hasAmbiguousIntent(aiState, intent)) {
    score -= 20;
  }

  const leadScore = clampLeadScore(score);

  return {
    lead_score: leadScore,
    lead_temperature: getLeadTemperature(leadScore),
  };
}

function hasSupplyCompleteData(lead = {}) {
  const preferredZones = Array.isArray(lead.preferred_zones) ? lead.preferred_zones : [];
  const notes = normalizeText(lead.notes_summary || '');

  return (
    lead.lead_type === 'supply' &&
    lead.budget_max != null &&
    preferredZones.length > 0 &&
    (
      !!lead.property_type ||
      notes.includes('tipo:')
    )
  );
}

function shouldTriggerHandoff(lead = {}) {
  if (!lead || typeof lead !== 'object') return false;
  if (lead.assigned_agent_profile_id) return false;

  if (Number(lead.lead_score || 0) > 70) return true;
  if (
    lead.intent_type === 'property_interest' ||
    lead.property_interest === true ||
    !!lead.interested_property_id
  ) {
    return true;
  }

  if (hasSupplyCompleteData(lead)) return true;

  return false;
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

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function extractReferralFromRawPayload(rawPayload = null) {
  if (!isPlainObject(rawPayload)) return null;

  const direct = rawPayload?.perseo_metadata?.whatsapp_referral;
  if (isPlainObject(direct)) return direct;

  const messageReferral = rawPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.referral;
  if (isPlainObject(messageReferral)) return messageReferral;

  const contextReferral = rawPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.context?.referral;
  if (isPlainObject(contextReferral)) return contextReferral;

  return null;
}

function parseUtmFromUrl(rawUrl) {
  const sourceUrl = firstNonEmptyString(rawUrl);
  if (!sourceUrl) return null;

  try {
    const parsed = new URL(sourceUrl);
    const pick = (name) => firstNonEmptyString(parsed.searchParams.get(name));
    const utm = {
      utm_source: pick('utm_source'),
      utm_medium: pick('utm_medium'),
      utm_campaign: pick('utm_campaign'),
      utm_term: pick('utm_term'),
      utm_content: pick('utm_content'),
    };
    const hasAny = Object.values(utm).some(Boolean);
    return hasAny ? utm : null;
  } catch (_err) {
    return null;
  }
}

function extractCampaignReferralContext({ aiState = {}, referral = null, rawPayload = null, messageText = '' } = {}) {
  const referralCandidate =
    (isPlainObject(referral) && referral) ||
    (isPlainObject(aiState?.whatsapp_referral) && aiState.whatsapp_referral) ||
    extractReferralFromRawPayload(rawPayload) ||
    null;

  const sourceUrl = firstNonEmptyString(
    referralCandidate?.source_url,
    referralCandidate?.sourceUrl,
    referralCandidate?.url,
    referralCandidate?.link
  );

  const sourceType = firstNonEmptyString(
    referralCandidate?.source_type,
    referralCandidate?.sourceType,
    referralCandidate?.type
  );

  const text = normalizeText(messageText || '');
  const sourcePlatform =
    (sourceUrl && /instagram\.com/i.test(sourceUrl) && 'instagram') ||
    (sourceUrl && /(facebook\.com|fb\.com)/i.test(sourceUrl) && 'facebook') ||
    (text.includes('instagram') && 'instagram') ||
    (text.includes('facebook') && 'facebook') ||
    (text.includes('meta ads') && 'meta') ||
    null;

  const campaignContext = {
    source_type: sourceType,
    source_id: firstNonEmptyString(referralCandidate?.source_id, referralCandidate?.sourceId),
    source_url: sourceUrl,
    ad_id: firstNonEmptyString(referralCandidate?.ad_id, referralCandidate?.adId, referralCandidate?.ad?.id),
    ad_name: firstNonEmptyString(
      referralCandidate?.ad_name,
      referralCandidate?.adName,
      referralCandidate?.ad_title,
      referralCandidate?.ad?.name
    ),
    ad_body: firstNonEmptyString(referralCandidate?.ad_body, referralCandidate?.body, referralCandidate?.text),
    adgroup_id: firstNonEmptyString(
      referralCandidate?.adgroup_id,
      referralCandidate?.adgroupId,
      referralCandidate?.adset_id,
      referralCandidate?.ad_set_id,
      referralCandidate?.adsetId
    ),
    campaign_id: firstNonEmptyString(referralCandidate?.campaign_id, referralCandidate?.campaignId, referralCandidate?.campaign?.id),
    campaign_name: firstNonEmptyString(referralCandidate?.campaign_name, referralCandidate?.campaignName, referralCandidate?.campaign?.name),
    ctwa_clid: firstNonEmptyString(referralCandidate?.ctwa_clid, referralCandidate?.ctwaClid, referralCandidate?.clid),
    source_platform: sourcePlatform,
    utm: parseUtmFromUrl(sourceUrl),
  };

  const hasCampaignContext = Object.values(campaignContext).some((value) => {
    if (value == null) return false;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return String(value).trim() !== '';
  });

  return {
    referralContext: referralCandidate,
    campaignContext: hasCampaignContext ? campaignContext : null,
    rawReferral: referralCandidate,
    hasCampaignContext,
  };
}

function detectLeadCreationOpportunity({ aiState = {}, propertyId = null, propertyCode = null, messageText = '', hasCampaignContext = false } = {}) {
  const text = normalizeText(messageText || '');
  const leadType = resolveLeadType(aiState);
  const hasPropertyReference = !!(
    propertyId ||
    aiState.direct_property_reference ||
    aiState.property_code ||
    aiState.direct_property_code ||
    propertyCode
  );

  const explicitCommercialSignals = !!(
    aiState.wants_visit ||
    aiState.asks_property_details ||
    aiState.wants_human ||
    aiState.shows_high_interest ||
    text.includes('me interesa') ||
    text.includes('quiero informacion') ||
    text.includes('quiero información') ||
    text.includes('quiero detalles') ||
    text.includes('precio') ||
    text.includes('disponible') ||
    text.includes('visita')
  );

  if (!hasPropertyReference && !explicitCommercialSignals && !hasCampaignContext) {
    return { shouldCreate: false, reason: 'ambiguous_or_non_commercial' };
  }

  if (!propertyId && hasPropertyReference) {
    return { shouldCreate: false, reason: 'property_not_found_for_reference' };
  }

  if (!leadType && !propertyId) {
    return { shouldCreate: false, reason: 'missing_lead_type' };
  }

  if (propertyId && explicitCommercialSignals) {
    return { shouldCreate: true, reason: 'property_interest_detected' };
  }

  if (propertyId && hasCampaignContext) {
    return { shouldCreate: true, reason: 'campaign_property_interest_detected' };
  }

  return { shouldCreate: false, reason: 'not_enough_context' };
}

function buildLeadContextFromConversation({
  conversation = null,
  aiState = {},
  property = null,
  propertyId = null,
  propertyCode = null,
  propertySlug = null,
  contactId = null,
  referralContext = null,
  campaignContext = null,
  rawReferral = null,
} = {}) {
  const normalizedPhone = normalizePhoneNumber(conversation?.phone) || conversation?.phone || null;

  return {
    normalizedPhone,
    contactId: contactId || conversation?.contact_id || null,
    conversationId: conversation?.id || null,
    propertyId: propertyId || property?.id || aiState?.interested_property_id || null,
    propertyCode: propertyCode || property?.listing_id || aiState?.property_code || aiState?.direct_property_code || null,
    propertySlug: propertySlug || property?.slug || null,
    userIntent: aiState?.intent_type || aiState?.lead_flow || null,
    sourceChannel: conversation?.channel || null,
    referralContext: referralContext || null,
    campaignContext: campaignContext || null,
    rawReferral: rawReferral || null,
    needsName: !aiState?.full_name,
    shouldAskForAdvisorContact: !!(
      aiState?.direct_property_reference ||
      aiState?.wants_visit ||
      aiState?.asks_property_details ||
      aiState?.shows_high_interest
    ),
  };
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

function summarizeRelevantMessageSignals(aiState = {}) {
  const signals = [];
  if (aiState.wants_visit) signals.push('quiere_visita');
  if (aiState.asks_property_details) signals.push('pide_detalles_propiedad');
  if (aiState.wants_human) signals.push('pidio_asesor_humano');
  if (aiState.shows_high_interest) signals.push('mostro_alto_interes');
  if (aiState.location_text) signals.push(`zona:${aiState.location_text}`);
  if (aiState.budget_max != null) signals.push(`presupuesto_max:${aiState.budget_max}`);
  if (aiState.property_type) signals.push(`tipo:${aiState.property_type}`);
  return signals;
}

function buildDetailedNotesSummary({ aiState = {}, conversation = {}, property = null, contactOwnerAssigned = false }) {
  const parts = [];
  const operation = resolveOperation(aiState, property);
  const leadType = resolveLeadType(aiState);
  const referral = aiState?.whatsapp_referral || aiState?.referral || aiState?.last_referral || null;

  parts.push(`Origen conversacion: ${conversation?.channel || 'unknown'} (conversation_id: ${conversation?.id || 'n/a'}).`);
  parts.push(`Telefono/WhatsApp: ${conversation?.phone || 'n/a'}.`);

  if (leadType || operation) {
    parts.push(`Intencion detectada: ${leadType || 'n/a'}${operation ? `/${operation}` : ''}.`);
  }

  if (property?.id || property?.listing_id || aiState?.interested_property_id || aiState?.property_code || aiState?.direct_property_code) {
    parts.push(
      `Propiedad interesada: ${property?.listing_id || aiState?.property_code || aiState?.direct_property_code || 'n/a'} (property_id: ${property?.id || aiState?.interested_property_id || 'n/a'}).`
    );
  }

  if (referral && typeof referral === 'object') {
    parts.push(`Referral: ${JSON.stringify(referral)}.`);
  }

  if (aiState?.campaign_context && typeof aiState.campaign_context === 'object') {
    parts.push(`Contexto de campaña: ${JSON.stringify(aiState.campaign_context)}.`);
  }

  const relevantSignals = summarizeRelevantMessageSignals(aiState);
  if (relevantSignals.length > 0) {
    parts.push(`Resumen mensajes relevantes: ${relevantSignals.join(', ')}.`);
  }

  if (contactOwnerAssigned) {
    parts.push('Motivo de asignacion: contacto ya registrado con agente asignado.');
  }

  const baseSummary = buildNotesSummary(aiState, property);
  if (baseSummary) parts.push(`Resumen caso: ${baseSummary}`);

  return parts.filter(Boolean).join(' ').slice(0, 1500);
}

function mergeLeadNotes(existingNotes, newNotes) {
  const previous = String(existingNotes || '').trim();
  const incoming = String(newNotes || '').trim();

  if (!incoming) return previous || null;
  if (!previous) return incoming;
  if (previous.includes(incoming)) return previous;

  return `${previous}\n\n---\n${incoming}`.slice(0, 1500);
}

function resolveContactAssignedAgentField(contact = {}) {
  if (!contact || typeof contact !== 'object') return { field: null, assignedAgentProfileId: null };

  const candidates = [
    'assigned_agent_profile_id',
    'agent_profile_id',
    'owner_profile_id',
    'assigned_to',
  ];

  for (const field of candidates) {
    const value = contact[field];
    if (value != null && String(value).trim() !== '') {
      return {
        field,
        assignedAgentProfileId: String(value).trim(),
      };
    }
  }

  return { field: null, assignedAgentProfileId: null };
}

async function findContactById(supabase, contactId) {
  if (!supabase || !contactId) return null;

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .maybeSingle();

  if (error) {
    console.error('LEAD_AUTOMATION_CONTACT_LOOKUP_ERROR', {
      contact_id: contactId,
      error: error.message,
    });
    return null;
  }

  return data || null;
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

async function findCompatibleLeadByPhoneAndProperty(supabase, { normalizedPhone, leadType, operation, propertyId }) {
  if (!normalizedPhone || !propertyId) return null;

  let query = supabase
    .from('leads')
    .select('*')
    .eq('phone', normalizedPhone)
    .eq('lead_type', leadType)
    .eq('interested_property_id', propertyId)
    .eq('is_active', true)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })
    .limit(1);

  if (operation) query = query.eq('interested_in_operation', operation);

  const { data, error } = await query;
  if (error) {
    console.error('LEAD_AUTOMATION_FIND_COMPATIBLE_PHONE_ERROR', { error: error.message });
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

async function updateLeadScoring(supabase, leadId, scoring) {
  if (!supabase || !leadId || !scoring) return null;

  const { data, error } = await supabase
    .from('leads')
    .update({
      lead_score: scoring.lead_score,
      lead_temperature: scoring.lead_temperature,
    })
    .eq('id', leadId)
    .select()
    .single();

  if (error) {
    console.error('LEAD_AUTOMATION_SCORING_UPDATE_ERROR', {
      lead_id: leadId,
      error: error.message,
    });
    return null;
  }

  return data || null;
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

async function assignLeadToContactOwner({
  supabase,
  lead,
  conversationId,
  assignedAgentProfileId,
  assignmentField,
  notesSummary,
  logger,
}) {
  if (!supabase || !lead?.id || !assignedAgentProfileId) {
    return {
      assignedAgentProfileId: null,
      assignmentResult: { success: false, reason: 'missing_contact_owner_assignment_data' },
      lead: lead || null,
    };
  }

  const updatePayload = {
    assigned_agent_profile_id: assignedAgentProfileId,
    notes_summary: mergeLeadNotes(lead.notes_summary, notesSummary),
  };

  if (Object.prototype.hasOwnProperty.call(lead, 'assignment_source')) {
    updatePayload.assignment_source = 'contact_owner';
  }

  const { data, error } = await supabase
    .from('leads')
    .update(updatePayload)
    .eq('id', lead.id)
    .select()
    .single();

  if (error) {
    logWarn(logger, 'LEAD_AUTOMATION_CONTACT_OWNER_ASSIGNMENT_FAILED', {
      lead_id: lead.id,
      assigned_agent_profile_id: assignedAgentProfileId,
      error: error.message,
    });
    await saveConversationEvent(supabase, conversationId, 'lead_assignment_failed', {
      lead_id: lead.id,
      reason: 'contact_owner_assignment_update_failed',
      error: error.message,
      source: 'contact_owner',
    });

    return {
      assignedAgentProfileId: null,
      assignmentResult: {
        success: false,
        reason: 'contact_owner_assignment_update_failed',
        error: error.message,
      },
      lead,
    };
  }

  await saveConversationEvent(supabase, conversationId, 'lead_assigned', {
    lead_id: lead.id,
    assigned_agent_profile_id: assignedAgentProfileId,
    assignment_source: 'contact_owner',
    contact_assignment_field: assignmentField,
    source: 'ai_agent',
  });

  log(logger, 'LEAD_AUTOMATION_ASSIGNED_CONTACT_OWNER', {
    lead_id: lead.id,
    assigned_agent_profile_id: assignedAgentProfileId,
    contact_assignment_field: assignmentField,
  });

  return {
    assignedAgentProfileId: assignedAgentProfileId,
    assignmentResult: {
      success: true,
      reason: 'contact_owner',
      assignment_source: 'contact_owner',
      contact_assignment_field: assignmentField,
    },
    lead: data || lead,
  };
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

    if (!contactId && !propertyId) {
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

    if (!contactId && propertyId) {
      log(logger, 'LEAD_AUTOMATION_CONTACTLESS_PROPERTY_FLOW', {
        conversation_id: conversationId,
        property_id: propertyId,
      });
      await saveConversationEvent(supabase, conversationId, 'lead_contact_missing_but_property_interest_detected', {
        property_id: propertyId,
        reason: 'contact_missing_property_interest',
      });
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
    const contact = await findContactById(supabase, contactId);
    const contactOwner = resolveContactAssignedAgentField(contact || {});
    const hasContactOwnerAssignedAgent = !!contactOwner.assignedAgentProfileId;
    const scoringIntent = {
      leadType,
      operationType: operation,
      property_code: aiState?.property_code || aiState?.direct_property_code || null,
      direct_property_reference: !!(aiState?.direct_property_reference || propertyId),
      budget_min: aiState?.budget_min,
      budget_max: aiState?.budget_max,
      location_text: aiState?.location_text,
      wants_visit: aiState?.wants_visit,
      wants_human: aiState?.wants_human,
      asks_property_details: aiState?.asks_property_details,
      confidence: aiState?.confidence,
    };
    const leadScoring = calculateLeadScore({
      aiState: {
        ...(aiState || {}),
        direct_property_reference: !!(aiState?.direct_property_reference || propertyId),
      },
      intent: scoringIntent,
    });
    const expected = {
      contactId,
      leadType,
      operation,
      propertyId: propertyId || null,
    };

    const detailedNotesSummary = buildDetailedNotesSummary({
      aiState,
      conversation,
      property,
      contactOwnerAssigned: hasContactOwnerAssignedAgent,
    });

    await saveConversationEvent(supabase, conversationId, 'lead_intent_detected', {
      lead_type: leadType,
      interested_in_operation: operation,
      interested_property_id: propertyId || null,
      lead_score: leadScoring.lead_score,
      lead_temperature: leadScoring.lead_temperature,
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

    if (!lead && contactId) {
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

    if (!lead && !contactId) {
      const normalizedConversationPhone = normalizePhoneNumber(conversation?.phone) || conversation?.phone || null;
      lead = await findCompatibleLeadByPhoneAndProperty(supabase, {
        normalizedPhone: normalizedConversationPhone,
        leadType,
        operation,
        propertyId: propertyId || null,
      });

      if (lead) {
        log(logger, 'LEAD_AUTOMATION_REUSE_BY_PHONE_PROPERTY', {
          conversation_id: conversationId,
          lead_id: lead.id,
          property_id: propertyId || null,
        });
        await saveConversationEvent(supabase, conversationId, 'lead_reused', {
          lead_id: lead.id,
          reason: 'compatible_active_lead_by_phone_property',
          source: 'ai_agent',
        });
      }
    }

    if (!lead) {
      const pipelineStageId = await getInitialPipelineStageId(supabase, leadType);

      const normalizedConversationPhone = normalizePhoneNumber(conversation?.phone) || conversation?.phone || null;
      const payload = {
        contact_id: contactId,
        lead_type: leadType,
        source: 'whatsapp',
        interested_property_id: propertyId || null,
        interested_in_operation: operation,
        notes_summary: detailedNotesSummary || null,
        budget_min: aiState?.budget_min != null ? Number(aiState.budget_min) : null,
        budget_max: aiState?.budget_max != null ? Number(aiState.budget_max) : null,
        preferred_zones: aiState?.location_text ? [String(aiState.location_text)] : null,
        lead_score: leadScoring.lead_score,
        lead_temperature: leadScoring.lead_temperature,
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
        lead_score: leadScoring.lead_score,
        lead_temperature: leadScoring.lead_temperature,
        source: 'ai_agent',
      });

      if (intentChanged) {
        await saveConversationEvent(supabase, conversationId, 'new_lead_created_due_to_intent_change', {
          lead_id: lead.id,
          lead_type: leadType,
          interested_in_operation: operation,
          interested_property_id: propertyId || null,
          lead_score: leadScoring.lead_score,
          lead_temperature: leadScoring.lead_temperature,
          source: 'ai_agent',
        });
      }
    }

    if (!wasCreated) {
      const leadUpdatePayload = {
        lead_score: leadScoring.lead_score,
        lead_temperature: leadScoring.lead_temperature,
        notes_summary: mergeLeadNotes(lead.notes_summary, detailedNotesSummary),
      };

      const { data: refreshedLead, error: leadUpdateError } = await supabase
        .from('leads')
        .update(leadUpdatePayload)
        .eq('id', lead.id)
        .select()
        .single();

      if (leadUpdateError) {
        console.error('LEAD_AUTOMATION_LEAD_UPDATE_ERROR', {
          lead_id: lead.id,
          error: leadUpdateError.message,
        });
        const scoredLead = await updateLeadScoring(supabase, lead.id, leadScoring);
        if (scoredLead) lead = scoredLead;
      } else if (refreshedLead) {
        lead = refreshedLead;
      }
    }

    const handoffCandidate = {
      ...lead,
      intent_type: aiState?.intent_type || aiState?.playbook_type || null,
      property_type: aiState?.property_type || lead.property_type || null,
      property_interest:
        aiState?.intent_type === 'property_interest' ||
        aiState?.playbook_type === 'property_interest' ||
        !!aiState?.direct_property_reference ||
        !!propertyId,
      handoff_sent: !!aiState?.handoff_sent,
    };
    const shouldHandoff = shouldTriggerHandoff(handoffCandidate);

    let assignedAgentProfileId = null;
    let assignmentResult = null;
    let handoffTriggered = false;

    if (hasContactOwnerAssignedAgent) {
      const ownerAssignment = await assignLeadToContactOwner({
        supabase,
        lead,
        conversationId,
        assignedAgentProfileId: contactOwner.assignedAgentProfileId,
        assignmentField: contactOwner.field,
        notesSummary: detailedNotesSummary,
        logger,
      });

      assignedAgentProfileId = ownerAssignment.assignedAgentProfileId;
      assignmentResult = ownerAssignment.assignmentResult;
      handoffTriggered = !!assignedAgentProfileId;
      if (ownerAssignment.lead) {
        lead = ownerAssignment.lead;
      }

      await saveConversationEvent(supabase, conversationId, 'lead_assignment_contact_owner_bypassed_engine', {
        lead_id: lead.id,
        assigned_agent_profile_id: assignedAgentProfileId,
        contact_assignment_field: contactOwner.field,
        reason: 'contact_already_has_assigned_agent',
        source: 'ai_agent',
      });
    } else if (shouldHandoff) {
      const assignment = await assignLead(
        supabase,
        lead.id,
        conversationId,
        logger
      );
      assignedAgentProfileId = assignment.assignedAgentProfileId;
      assignmentResult = assignment.assignmentResult;
      handoffTriggered = !!assignedAgentProfileId;
    } else {
      await saveConversationEvent(supabase, conversationId, 'lead_handoff_deferred', {
        lead_id: lead.id,
        lead_score: lead.lead_score ?? leadScoring.lead_score,
        lead_temperature: lead.lead_temperature || leadScoring.lead_temperature,
        intent_type: handoffCandidate.intent_type,
        reason: 'lead_not_ready_for_handoff',
        source: 'ai_agent',
      });
    }

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
      nextAiState.handoff_ready = true;
      nextAiState.handoff_sent = true;
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
      shouldHandoff,
      handoffTriggered,
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

/**
 * Construye un resumen detallado de notas para un lead de pauta abandonada.
 */
function buildPautaAbandonedNotes({ aiState, conversation, referral, lastInbound }) {
  const parts = [];

  parts.push('Origen: pauta/referral de WhatsApp.');

  if (referral && typeof referral === 'object') {
    if (referral.headline) parts.push(`Anuncio: "${referral.headline}".`);
    if (referral.ad_name) parts.push(`Nombre del anuncio: ${referral.ad_name}.`);
    if (referral.campaign_name) parts.push(`Campaña: ${referral.campaign_name}.`);
    if (referral.source_url) parts.push(`URL fuente: ${referral.source_url}.`);
    if (referral.ad_id) parts.push(`Ad ID: ${referral.ad_id}.`);
    if (referral.campaign_id) parts.push(`Campaign ID: ${referral.campaign_id}.`);
    if (referral.ctwa_clid) parts.push(`CTWA CLID: ${referral.ctwa_clid}.`);
    if (referral.source_type) parts.push(`Tipo de fuente: ${referral.source_type}.`);
  }

  parts.push(`Conversación ID: ${conversation?.id || 'n/a'}.`);
  parts.push(`Teléfono: ${conversation?.phone || 'n/a'}.`);

  const intentLabel = aiState?.intent_type || aiState?.lead_flow || null;
  if (intentLabel) parts.push(`Intención detectada: ${intentLabel}.`);

  const propertyMentioned = aiState?.property_code || aiState?.direct_property_code || null;
  if (propertyMentioned) parts.push(`Propiedad mencionada: ${propertyMentioned}.`);

  if (lastInbound?.message_text) {
    parts.push(`Último mensaje recibido: "${String(lastInbound.message_text).slice(0, 200)}".`);
  }

  if (lastInbound?.created_at) {
    parts.push(`Fecha/hora del último inbound: ${lastInbound.created_at}.`);
  }

  parts.push('Motivo de asignación: pauta abandonada después de follow-ups de inactividad.');

  return parts.filter(Boolean).join(' ').slice(0, 1500);
}

/**
 * Crea un lead en public.leads asignado al Agente Especial cuando una conversación
 * proveniente de pauta es cerrada por inactividad.
 *
 * Reglas:
 * - Si ya existe lead vinculado a la conversación: no crea duplicado, solo registra evento.
 * - Si el contacto ya tiene agente asignado: respeta ese agente, no usa Agente Especial.
 * - Si no se encontró el Agente Especial: aborta con evento de error.
 */
async function createPautaAbandonedLead({
  supabase,
  conversation,
  aiState,
  messages = [],
  specialAgentProfileId,
  logger = console,
}) {
  const conversationId = conversation?.id || null;

  try {
    // 1. Evitar duplicado: verificar si ya existe lead vinculado
    const existingLeadId = conversation?.lead_id || aiState?.lead_id || null;
    if (existingLeadId) {
      const existingLead = await findLeadByConversation(supabase, existingLeadId);
      if (existingLead?.id) {
        await saveConversationEvent(supabase, conversationId, 'pauta_lead_skipped_already_exists', {
          lead_id: existingLead.id,
          reason: 'lead_already_exists_in_conversation',
          source: 'inactivity_followup_job',
        });
        return { created: false, reason: 'lead_already_exists', leadId: existingLead.id };
      }
    }

    // 2. Respetar agente del contacto si ya tiene uno asignado
    const contactId = conversation?.contact_id || null;
    let contact = null;
    if (contactId) {
      contact = await findContactById(supabase, contactId);
    }
    const contactOwner = resolveContactAssignedAgentField(contact || {});
    if (contactOwner.assignedAgentProfileId) {
      await saveConversationEvent(supabase, conversationId, 'pauta_lead_skipped_contact_has_agent', {
        contact_id: contactId,
        assigned_agent_profile_id: contactOwner.assignedAgentProfileId,
        reason: 'contact_already_has_assigned_agent',
        source: 'inactivity_followup_job',
      });
      return { created: false, reason: 'contact_has_assigned_agent' };
    }

    // 3. Verificar que el Agente Especial fue encontrado
    if (!specialAgentProfileId) {
      await saveConversationEvent(supabase, conversationId, 'pauta_lead_skipped_no_special_agent', {
        reason: 'special_agent_not_found',
        source: 'inactivity_followup_job',
      });
      return { created: false, reason: 'special_agent_not_found' };
    }

    // 4. Construir notas con toda la información disponible
    const referral = aiState?.whatsapp_referral || null;
    const lastInbound = [...(messages || [])].reverse().find((m) => m.direction === 'inbound') || null;
    const notes = buildPautaAbandonedNotes({ aiState, conversation, referral, lastInbound });

    // 5. Determinar tipo de lead y operación
    const leadType = resolveLeadType(aiState) || 'demand';
    const operation = resolveOperation(aiState, null);

    // 6. Obtener pipeline stage inicial
    const pipelineStageId = await getInitialPipelineStageId(supabase, leadType);

    // 7. Crear lead con Agente Especial asignado
    const normalizedPhone = normalizePhoneNumber(conversation?.phone) || conversation?.phone || null;
    const payload = {
      contact_id: contactId || null,
      lead_type: leadType,
      source: 'whatsapp',
      interested_in_operation: operation,
      notes_summary: notes,
      assigned_agent_profile_id: specialAgentProfileId,
      pipeline_stage_id: pipelineStageId,
      status: 'new',
      is_active: true,
      is_archived: false,
      phone: normalizedPhone,
      whatsapp: normalizedPhone,
      next_action: 'Seguimiento pauta abandonada',
      next_action_due_at: nowIso(),
    };

    const { data, error } = await insertLeadWithSourceFallback(supabase, payload);
    if (error || !data) {
      throw new Error(error?.message || 'pauta_lead_insert_failed');
    }

    // 8. Vincular lead a la conversación
    await syncConversation(supabase, conversationId, { lead_id: data.id });

    // 9. Registrar evento
    await saveConversationEvent(supabase, conversationId, 'pauta_abandoned_lead_created', {
      lead_id: data.id,
      assigned_agent_profile_id: specialAgentProfileId,
      lead_type: leadType,
      has_referral: !!referral,
      source: 'inactivity_followup_job',
    });

    log(logger, 'PAUTA_ABANDONED_LEAD_CREATED', {
      conversation_id: conversationId,
      lead_id: data.id,
      assigned_agent_profile_id: specialAgentProfileId,
      lead_type: leadType,
    });

    return { created: true, leadId: data.id, lead: data };
  } catch (err) {
    logWarn(logger, 'PAUTA_ABANDONED_LEAD_ERROR', {
      conversation_id: conversationId,
      error: err?.message || String(err),
    });
    await saveConversationEvent(supabase, conversationId, 'pauta_abandoned_lead_failed', {
      error: err?.message || String(err),
      reason: 'lead_creation_error',
      source: 'inactivity_followup_job',
    });
    return { created: false, reason: 'error', error: err?.message };
  }
}

module.exports = {
  calculateLeadScore,
  shouldTriggerHandoff,
  detectLeadCreationOpportunity,
  extractCampaignReferralContext,
  buildLeadContextFromConversation,
  createOrReuseLeadFromConversation,
  createPautaAbandonedLead,
};
