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
