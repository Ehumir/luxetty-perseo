function getDefaultAiState() {
  return {
    lead_flow: null,
    operation_type: null,
    lead_role: null,
    property_type: null,
    zone: null,

    location_text: null,
    matched_location_from_catalog: null,
    location_any: false,

    budget_min: null,
    budget_max: null,
    budget_currency: null,

    bedrooms: null,
    bedrooms_any: false,
    bathrooms: null,
    terrain_m2: null,
    construction_m2: null,
    floors_count: null,
    garage_spaces: null,
    has_terrace_patio: null,
    occupancy_status: null,
    occupancy_duration_text: null,
    occupancy_entry_mode: null,
    heirs_relation: null,
    can_share_documents: null,

    legal_deeded: null,
    has_mortgage: null,
    mortgage_balance_text: null,
    works_with_realtor: null,
    exclusivity_type: null,
    expected_price: null,
    asking_price: null,

    sale_motivation: null,
    is_exploring_sale: null,
    accepted_visit: null,
    asks_commission: false,
    asks_only_valuation: false,
    asks_valuation: false,
    objection_higher_other_agency: false,
    objection_no_exclusivity: false,
    objection_existing_realtor: false,
    asks_direct_purchase: false,
    urgent_sale_signal: false,
    sell_buy_bridge: false,
    investor_profile: false,
    remote_client: false,
    complaint_followup: false,
    low_info_campaign_message: false,
    non_real_estate_or_provider: false,

    seller_scenarios: [],
    primary_seller_scenario: null,
    legal_sensitive: false,
    already_listed: null,
    listing_duration_days: null,
    has_documents: null,
    municipality_text: null,
    neighborhood_text: null,
    risk_flags: [],
    missing_information: [],
    crm_structured_summary: null,
    needs_specialized_review: false,

    last_media_type: null,
    last_media_category: null,
    last_media_id: null,
    last_media_mime_type: null,
    last_media_file_name: null,
    last_media_map_url: null,
    last_media_forwarded: false,
    last_media_detected_not_processed: false,
    last_media_unsupported: false,
    property_image_candidate: false,
    legal_or_property_document_candidate: false,

    property_code: null,
    direct_property_code: null,
    direct_property_reference: false,
    property_specific_intent: false,
    interested_property_id: null,
    property_context: null,
    property_generic_cta_shown_for_code: null,
    property_intro_shown_for_code: null,
    property_last_follow_up_intent: null,
    property_pending_user_question: null,

    current_property_code: null,
    current_interested_property_id: null,
    property_history: [],
    property_context_by_code: {},

    last_audio_transcription: null,
    has_audio_without_transcription: false,
    last_image_vision_status: null,
    last_image_vision_summary: null,
    last_image_vision_confidence: null,
    last_image_vision_property_type: null,
    last_image_vision_area_type: null,
    last_image_vision_condition: null,
    context_fusion: null,

    must_have_features: [],
    timeline_text: null,
    urgency_level: null,
    urgency: null,
    rental_move_in_date: null,
    rental_people_count: null,
    rental_pets: null,
    rental_special_requirements: null,

    full_name: null,
    /** Set when UI pidió nombre pero awaiting_field comercial sigue activo (p. ej. presupuesto). */
    pending_name_capture: false,
    contact_name: null,
    owner_relation: null,
    contact_preference: null,
    preferred_contact_channel: null,
    contact_number_confirmed: null,
    confirmed_phone: null,
    campaign_context: null,
    /** Última pauta detectada (propiedad vs captación) para retomar tono tras capturar nombre. */
    entry_point_last: null,
    current_intent: null,
    last_clear_intent: null,
    pending_question: null,
    intent_lock_sale_owner: false,
    inbound_business_category: null,
    external_broker: false,
    provider: false,
    spam_detected: false,
    wrong_context: false,
    unclear_non_real_estate: false,

    awaiting_field: null,
    last_change_type: null,
    intent_version: 1,

    needs_fresh_search: false,
    last_search_filters: null,
    last_search_result_count: 0,
    last_shown_property_ids: [],

    wants_human: false,
    wants_visit: false,
    shows_high_interest: false,
    asks_property_details: false,
    user_goal: null,
    intent_type: null,
    intent_changed: false,
    next_step: null,
    playbook_type: null,
    playbook: null,
    playbook_step: null,
    confidence: 'low',

    geo_qualified: null,
    value_qualified: null,
    capture_qualified: null,

    handoff_ready: false,
    handoff_sent: false,
    closing_message_sent: false,

    /** P0.1 — Anti-loop: tipos de pregunta saliente recientes (nombre, generic_help, etc.). */
    anti_loop_recent_question_types: [],
    /** P0.1 — Firmas normalizadas de outbound reciente (dedupe). */
    anti_loop_last_outbound_sigs: [],
    /** P0.1 — Rachas consecutivas del mismo bucket de fallback consultivo. */
    anti_loop_fallback_streak: 0,
    anti_loop_last_fallback_bucket: null,
  };
}

function normalizeAiState(rawState) {
  const base = getDefaultAiState();

  if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
    return base;
  }

  const normalized = {
    ...base,
    ...rawState,
    must_have_features: Array.isArray(rawState.must_have_features)
      ? rawState.must_have_features
      : [],
    last_shown_property_ids: Array.isArray(rawState.last_shown_property_ids)
      ? rawState.last_shown_property_ids
      : [],
    playbook: Array.isArray(rawState.playbook)
      ? rawState.playbook
      : base.playbook,
    seller_scenarios: Array.isArray(rawState.seller_scenarios)
      ? rawState.seller_scenarios
      : [],
    risk_flags: Array.isArray(rawState.risk_flags)
      ? rawState.risk_flags
      : [],
    missing_information: Array.isArray(rawState.missing_information)
      ? rawState.missing_information
      : [],
    property_history: Array.isArray(rawState.property_history) ? rawState.property_history : [],
    property_context_by_code:
      rawState.property_context_by_code && typeof rawState.property_context_by_code === 'object'
        ? rawState.property_context_by_code
        : {},
    anti_loop_recent_question_types: Array.isArray(rawState.anti_loop_recent_question_types)
      ? rawState.anti_loop_recent_question_types
      : [],
    anti_loop_last_outbound_sigs: Array.isArray(rawState.anti_loop_last_outbound_sigs)
      ? rawState.anti_loop_last_outbound_sigs
      : [],
    anti_loop_fallback_streak:
      rawState.anti_loop_fallback_streak != null && Number.isFinite(Number(rawState.anti_loop_fallback_streak))
        ? Number(rawState.anti_loop_fallback_streak)
        : 0,
    anti_loop_last_fallback_bucket:
      rawState.anti_loop_last_fallback_bucket != null ? String(rawState.anti_loop_last_fallback_bucket) : null,
  };

  if (!normalized.intent_type && normalized.playbook_type) {
    normalized.intent_type = normalized.playbook_type;
  }

  return normalized;
}

module.exports = {
  getDefaultAiState,
  normalizeAiState,
};
