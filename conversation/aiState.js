function getDefaultAiState() {
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
    last_audio_transcription: null,
    has_audio_without_transcription: false,

    must_have_features: [],
    timeline_text: null,
    urgency_level: null,

    full_name: null,
    owner_relation: null,
    contact_preference: null,
    contact_number_confirmed: null,

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
