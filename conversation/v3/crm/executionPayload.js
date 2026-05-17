'use strict';

const { normalizeInboundPhoneForV3 } = require('../../../config/perseoV3Flags');
const { mapV3StateToLegacyAiState } = require('../state/v3ToLegacyAiState');
const { buildCrmDryRunPayload } = require('./payloadBuilder');

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function buildConversationSummary(state) {
  const parts = [];
  const name = state.collectedFields?.fullName;
  if (name) parts.push(`Nombre: ${name}`);
  if (state.locationText) parts.push(`Zona: ${state.locationText}`);
  if (state.expectedPrice != null) parts.push(`Precio esperado: ${state.expectedPrice}`);
  if (state.valuationRequested || state.priceUnknown) parts.push('Valuación solicitada (sin precio fijo)');
  if (state.budget != null) parts.push(`Presupuesto: ${state.budget}`);
  if (state.propertyListingCode) parts.push(`Propiedad: ${state.propertyListingCode}`);
  if (state.propertyType || state.collectedFields?.propertyType) {
    parts.push(`Tipo: ${state.propertyType || state.collectedFields?.propertyType}`);
  }
  if (state.occupancyStatus || state.collectedFields?.occupancyStatus) {
    parts.push(`Ocupación: ${state.occupancyStatus || state.collectedFields?.occupancyStatus}`);
  }
  return parts.join(' · ') || null;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string|null} phone
 */
function buildV3CrmExecutionPayload(state, phone) {
  const preview = buildCrmDryRunPayload(state);
  if (!preview) return null;

  const normalizedPhone = normalizeInboundPhoneForV3(phone || state.phone);

  return {
    ...preview,
    phone_normalized: normalizedPhone,
    contact_name: state.collectedFields?.fullName ?? null,
    conversation_goal: state.conversationGoal ?? null,
    source: 'PERSEO_V3',
    channel: 'whatsapp',
    consent: 'ACCEPTED',
    handoff_reason:
      state.handoffReason || state.unhandledReason || preview.flow_key || 'conversion_ready',
    captured_slots: {
      full_name: state.collectedFields?.fullName ?? null,
      location_text: state.locationText ?? null,
      expected_price: state.expectedPrice ?? null,
      price_unknown: state.priceUnknown === true,
      valuation_requested: state.valuationRequested === true,
      budget: state.budget ?? null,
      bedrooms: state.bedrooms ?? null,
      property_type: state.propertyType || state.collectedFields?.propertyType || null,
      occupancy_status: state.occupancyStatus || state.collectedFields?.occupancyStatus || null,
      property_listing_code: state.propertyListingCode ?? null,
      payment_method: state.paymentMethod ?? null,
    },
    property_listing_code: state.propertyListingCode ?? null,
    interested_property_id:
      state.activeProperty && state.activeProperty.id != null
        ? String(state.activeProperty.id)
        : null,
    summary: buildConversationSummary(state),
    crm_payload_preview: preview,
  };
}

/**
 * Proyecta estado V3 al shape que espera leadAutomation (sin duplicar reglas de negocio).
 * @param {import('../types/conversationState').ConversationState} state
 * @param {Record<string, unknown>} executionPayload
 */
function mapV3StateToLeadAutomationAiState(state, executionPayload) {
  const legacy = mapV3StateToLegacyAiState(state);
  const goal = state.conversationGoal || '';

  /** @type {Record<string, unknown>} */
  const aiState = {
    ...legacy,
    qualification_complete: true,
    advisor_contact_consent: 'ACCEPTED',
    shows_high_interest: true,
    wants_human: true,
    confidence: 'high',
    v3_crm_source: executionPayload.source || 'PERSEO_V3',
    v3_channel: executionPayload.channel || 'whatsapp',
    handoff_reason: executionPayload.handoff_reason || null,
    crm_payload_preview: executionPayload.crm_payload_preview || executionPayload,
    perseo_v3_execution_payload: executionPayload,
  };

  if (goal.includes('SELL') || goal.includes('RENT_OUT')) {
    aiState.user_goal = 'property_capture';
  } else if (goal.includes('BUY') || goal.includes('RENT') || goal === 'PROPERTY_INQUIRY') {
    aiState.user_goal = 'property_search';
  }

  if (state.valuationRequested || state.priceUnknown) {
    aiState.valuation_requested = true;
    aiState.price_unknown = true;
  }

  return aiState;
}

module.exports = {
  buildV3CrmExecutionPayload,
  buildConversationSummary,
  mapV3StateToLeadAutomationAiState,
};
