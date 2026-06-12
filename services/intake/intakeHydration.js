'use strict';

const { normalizePhoneNumber } = require('../../utils/helpers');
const { cleanSpaces } = require('../../utils/text');
const {
  isPhoneOnPerseoQaAllowlist,
  normalizeInboundPhoneForV3,
} = require('../../config/perseoV3Flags');
const { extractBridgeToken } = require('./extractBridgeToken');
const { parseConversationContext, isWithinGateWindow } = require('./conversationContextSchema');

const DEFAULT_WINDOW_HOURS = Number(process.env.PERSEO_APA_INTAKE_WINDOW_HOURS || 48);

function isApaIntakeHydrationEnabled() {
  return process.env.PERSEO_APA_INTAKE_HYDRATION === 'true';
}

/** Flag global ON + teléfono inbound en PERSEO_V3_QA_ALLOWLIST (canary prod). */
function isApaIntakeHydrationEnabledForPhone(phone) {
  if (!isApaIntakeHydrationEnabled()) return false;
  return isPhoneOnPerseoQaAllowlist(phone);
}

function logApaIntakeSkippedNotAllowlisted(phone, logEvent) {
  const inbound_normalized = normalizeInboundPhoneForV3(phone);
  const payload = { inbound_normalized };
  console.log('apa_intake_skipped_not_allowlisted', payload);
  if (typeof logEvent === 'function') {
    logEvent('apa_intake_skipped_not_allowlisted', payload);
  }
}

function inferLandingKey({
  parsedSignals = {},
  aiState = {},
  propertyId = null,
  text = '',
} = {}) {
  const entryMeta = parsedSignals.__entry_point_meta || aiState.entry_point_last || {};
  const entryType = entryMeta.entry_type || aiState.entry_type || null;
  const campaign = aiState.campaign_context && typeof aiState.campaign_context === 'object'
    ? aiState.campaign_context
    : {};
  const landingSlug = cleanSpaces(String(campaign.landing_slug || aiState.landing_slug || '')).toLowerCase();
  const campaignKey = cleanSpaces(String(campaign.campaign_context_key || '')).toLowerCase();
  const normalizedText = cleanSpaces(String(text || '')).toLowerCase();

  if (propertyId || entryType === 'property_ad' || landingSlug.includes('/propiedad/')) {
    return 'property_demand';
  }
  if (
    campaignKey === 'medical_consultorios_monterrey' ||
    landingSlug.includes('consultorios-medicos') ||
    normalizedText.includes('consultorio')
  ) {
    return 'medical_consultorios';
  }
  if (
    campaignKey === 'prevaluacion_cumbres' ||
    entryType === 'seller_capture_ad' ||
    landingSlug.includes('cumbres') ||
    normalizedText.includes('prevaluacion') ||
    normalizedText.includes('prevaluación')
  ) {
    return 'cumbres_supply';
  }
  return null;
}

function mapConversationContextToAiState(context, intakeRow = {}) {
  const leadFlow = context.lead_type === 'demand' ? 'demand' : 'offer';
  const propertyId = context.property?.property_id || null;
  const listingId = context.property?.listing_id || null;

  const campaignContext = {
    ...(context.campaign || {}),
    landing_key: context.landing_key,
    landing_slug: context.landing_slug,
    capture_channel: context.capture_channel,
    campaign_context_key: context.campaign?.campaign_context_key || null,
    intake_answers: context.answers || {},
    intake_id: context.intake_id || intakeRow.id || null,
    bridge_token: context.bridge_token || intakeRow.bridge_token || null,
    source_context: 'apa_intake_layer',
  };

  const patch = {
    lead_id: context.lead_id,
    contact_id: context.contact_id,
    full_name: context.identity?.full_name || null,
    lead_flow: leadFlow,
    lead_type: context.lead_type,
    intake_source: context.landing_key,
    intake_id: context.intake_id || intakeRow.id || null,
    campaign_context: campaignContext,
    entry_point_last: {
      entry_type: context.perseo?.entry_type || null,
      lead_flow: leadFlow,
      landing_key: context.landing_key,
      property_code: listingId || null,
      location_text: context.answers?.zone_or_neighborhood || null,
    },
    apa_intake_hydrated: true,
    apa_intake_bridge_token: context.bridge_token || intakeRow.bridge_token || null,
  };

  if (propertyId) {
    patch.interested_property_id = propertyId;
    if (listingId) {
      patch.property_code = listingId;
      patch.direct_property_code = listingId;
    }
  }

  if (context.landing_key === 'property_demand' && context.crm?.solicitud_created) {
    patch.property_solicitud_verified = true;
    patch.property_solicitud_pending = false;
  }

  if (context.intent?.primary) {
    patch.intent_type = context.intent.primary;
  }

  if (context.answers?.operation_intent) {
    patch.operation_type = context.answers.operation_intent;
  }

  if (context.answers?.zone_or_neighborhood) {
    patch.location_text = context.answers.zone_or_neighborhood;
  }

  if (context.answers?.property_type) {
    patch.property_type = context.answers.property_type;
  }

  return patch;
}

function buildIntakeRowResult(row) {
  if (!row) return null;
  const parsed = parseConversationContext(row.conversation_context);
  if (!parsed.ok) return null;

  const windowHours = parsed.context.perseo?.gate_window_hours || DEFAULT_WINDOW_HOURS;
  const completedAt =
    parsed.context.intake_completed_at || row.created_at || null;

  if (!isWithinGateWindow(completedAt, windowHours)) {
    return { expired: true, row, context: parsed.context };
  }

  if (!parsed.context.intake_id && row.id) {
    parsed.context.intake_id = row.id;
  }

  return {
    expired: false,
    row,
    context: parsed.context,
    resolution: row.resolution || null,
  };
}

async function findIntakeByBridgeToken(supabase, bridgeToken) {
  if (!supabase || !bridgeToken) return null;

  const { data, error } = await supabase
    .from('intake_submissions')
    .select('id, landing_key, lead_id, contact_id, bridge_token, conversation_context, status, created_at')
    .eq('bridge_token', bridgeToken)
    .in('status', ['completed', 'bridged'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('APA_INTAKE_BRIDGE_LOOKUP_ERROR', { error: error.message });
    return null;
  }

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!row) return null;

  const built = buildIntakeRowResult({ ...row, resolution: 'bridge_token' });
  if (!built || built.expired) return built;
  return built;
}

async function findRecentIntakeSubmission(
  supabase,
  { normalizedPhone, landingKey, propertyId = null, windowHours = DEFAULT_WINDOW_HOURS },
) {
  if (!supabase || !normalizedPhone || !landingKey) return null;

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const { data: contacts, error: contactError } = await supabase
    .from('contacts')
    .select('id')
    .eq('whatsapp_normalized', normalizedPhone)
    .limit(1);

  if (contactError) {
    console.error('APA_INTAKE_CONTACT_LOOKUP_ERROR', { error: contactError.message });
    return null;
  }

  const contactId = Array.isArray(contacts) && contacts[0]?.id ? contacts[0].id : null;
  if (!contactId) return null;

  const { data, error } = await supabase
    .from('intake_submissions')
    .select('id, landing_key, lead_id, contact_id, bridge_token, conversation_context, status, created_at')
    .eq('contact_id', contactId)
    .eq('landing_key', landingKey)
    .not('lead_id', 'is', null)
    .gte('created_at', since)
    .in('status', ['completed', 'bridged'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('APA_INTAKE_FALLBACK_LOOKUP_ERROR', { error: error.message });
    return null;
  }

  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    const parsed = parseConversationContext(row.conversation_context);
    if (!parsed.ok) continue;

    if (landingKey === 'property_demand' && propertyId) {
      const ctxPropertyId = parsed.context.property?.property_id || null;
      if (ctxPropertyId && ctxPropertyId !== propertyId) continue;
    }

    const built = buildIntakeRowResult({ ...row, resolution: 'fallback_48h' });
    if (!built || built.expired) continue;
    return built;
  }

  return null;
}

async function markIntakeBridged(supabase, intakeId) {
  if (!supabase || !intakeId) return false;

  const { error } = await supabase
    .from('intake_submissions')
    .update({ status: 'bridged' })
    .eq('id', intakeId)
    .in('status', ['completed', 'bridged']);

  if (error) {
    console.error('APA_INTAKE_MARK_BRIDGED_ERROR', { intake_id: intakeId, error: error.message });
    return false;
  }
  return true;
}

async function resolveIntakeContext({
  supabase,
  phone,
  text = '',
  referral = null,
  parsedSignals = {},
  aiState = {},
  propertyId = null,
}) {
  const bridgeToken = extractBridgeToken({ text, referral });
  if (bridgeToken) {
    const byToken = await findIntakeByBridgeToken(supabase, bridgeToken);
    if (byToken && !byToken.expired) return byToken;
    if (byToken?.expired) return { expired: true, resolution: 'bridge_token' };
  }

  const normalizedPhone = normalizePhoneNumber(phone) || phone;
  const landingKey = inferLandingKey({ parsedSignals, aiState, propertyId, text });
  if (!landingKey) return null;

  const byFallback = await findRecentIntakeSubmission(supabase, {
    normalizedPhone,
    landingKey,
    propertyId: landingKey === 'property_demand' ? propertyId : null,
  });

  if (byFallback && !byFallback.expired) return byFallback;
  if (byFallback?.expired) return { expired: true, resolution: 'fallback_48h', landing_key: landingKey };
  return null;
}

/**
 * Hook pre-V3: hidrata ai_state desde intake_submissions sin tocar V2/V3 core.
 * @returns {Promise<{ handled: boolean, statePatch?: object, signalsPatch?: object, skipLegacyCrm?: boolean, resolution?: string, intake_id?: string }>}
 */
async function tryIntakeHydrationTurn({
  supabase,
  phone,
  text = '',
  referral = null,
  previousAiState = {},
  parsedSignals = {},
  property = null,
  propertyId = null,
  logEvent = null,
}) {
  if (!isApaIntakeHydrationEnabled()) {
    return { handled: false, disabled: true };
  }

  if (!isPhoneOnPerseoQaAllowlist(phone)) {
    logApaIntakeSkippedNotAllowlisted(phone, logEvent);
    return { handled: false, skipped_not_allowlisted: true };
  }

  const resolvedPropertyId =
    propertyId || property?.id || previousAiState.interested_property_id || null;

  const resolved = await resolveIntakeContext({
    supabase,
    phone,
    text,
    referral,
    parsedSignals,
    aiState: previousAiState,
    propertyId: resolvedPropertyId,
  });

  if (!resolved) {
    return { handled: false };
  }

  if (resolved.expired) {
    if (typeof logEvent === 'function') {
      logEvent('apa_intake_hydration_expired', {
        resolution: resolved.resolution || null,
        landing_key: resolved.landing_key || null,
      });
    }
    return { handled: false, expired: true };
  }

  const statePatch = mapConversationContextToAiState(resolved.context, resolved.row);
  const skipLegacyCrm = resolved.context.crm?.solicitud_created === true;

  await markIntakeBridged(supabase, resolved.row.id);

  const signalsPatch = {
    lead_flow: statePatch.lead_flow,
    full_name: statePatch.full_name || undefined,
    lead_id: statePatch.lead_id,
    contact_id: statePatch.contact_id,
  };

  if (typeof logEvent === 'function') {
    logEvent('apa_intake_hydration_applied', {
      intake_id: resolved.row.id,
      lead_id: statePatch.lead_id,
      landing_key: resolved.context.landing_key,
      resolution: resolved.resolution,
      skip_legacy_crm: skipLegacyCrm,
    });
  }

  return {
    handled: true,
    statePatch,
    signalsPatch,
    skipLegacyCrm,
    resolution: resolved.resolution,
    intake_id: resolved.row.id,
    responseSource: 'apa_intake_hydration',
  };
}

module.exports = {
  isApaIntakeHydrationEnabled,
  isApaIntakeHydrationEnabledForPhone,
  logApaIntakeSkippedNotAllowlisted,
  inferLandingKey,
  mapConversationContextToAiState,
  findIntakeByBridgeToken,
  findRecentIntakeSubmission,
  markIntakeBridged,
  resolveIntakeContext,
  tryIntakeHydrationTurn,
  DEFAULT_WINDOW_HOURS,
};
