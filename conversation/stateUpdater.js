const { normalizeAiState, getDefaultAiState } = require('./aiState');

function mergeUnique(listA = [], listB = []) {
  return Array.from(new Set([...(Array.isArray(listA) ? listA : []), ...(Array.isArray(listB) ? listB : [])]));
}

function getIntentFamily(intentType, leadFlow) {
  if (intentType === 'supply' || leadFlow === 'offer') return 'supply';
  if (intentType === 'demand' || intentType === 'property_interest' || leadFlow === 'demand') return 'demand';
  return null;
}

function detectStateChange(prevState, signals) {
  const prev = normalizeAiState(prevState);
  const prevIntentFamily = getIntentFamily(prev.intent_type, prev.lead_flow);
  const nextIntentFamily = getIntentFamily(signals.intent_type, signals.lead_flow);

  const flowChanged =
    signals.lead_flow &&
    prev.lead_flow &&
    signals.lead_flow !== prev.lead_flow;

  const intentFamilyChanged =
    !!signals.intent_changed &&
    !!prevIntentFamily &&
    !!nextIntentFamily &&
    prevIntentFamily !== nextIntentFamily;

  if (flowChanged || intentFamilyChanged) return 'restart_flow';

  const operationChanged =
    signals.operation_type &&
    prev.operation_type &&
    signals.operation_type !== prev.operation_type;

  const propertyTypeChanged =
    signals.property_type &&
    prev.property_type &&
    signals.property_type !== prev.property_type;

  const locationChanged =
    signals.location_text &&
    prev.location_text &&
    signals.location_text !== prev.location_text;

  if (operationChanged || propertyTypeChanged || locationChanged || signals.location_any) {
    return 'radical_change';
  }

  const budgetChanged =
    signals.budget_max !== null &&
    signals.budget_max !== undefined &&
    prev.budget_max !== null &&
    prev.budget_max !== undefined &&
    signals.budget_max !== prev.budget_max;

  if (budgetChanged || signals.bedrooms_any) return 'minor_update';

  return 'append_info';
}

function buildNextState(prevState, signals, changeType) {
  const prev = normalizeAiState(prevState);
  let next;

  if (changeType === 'restart_flow') {
    next = {
      ...getDefaultAiState(),
      lead_flow: signals.lead_flow || null,
      operation_type: signals.operation_type || null,
      property_type: signals.property_type || null,
      location_text: signals.location_text || null,
      matched_location_from_catalog: signals.matched_location_from_catalog || null,
      budget_max:
        signals.budget_max !== null && signals.budget_max !== undefined
          ? signals.budget_max
          : null,
      budget_currency: signals.budget_currency || null,
      bedrooms:
        signals.bedrooms !== null && signals.bedrooms !== undefined
          ? signals.bedrooms
          : null,
      bathrooms:
        signals.bathrooms !== null && signals.bathrooms !== undefined
          ? signals.bathrooms
          : null,
      terrain_m2:
        signals.terrain_m2 !== null && signals.terrain_m2 !== undefined
          ? signals.terrain_m2
          : null,
      construction_m2:
        signals.construction_m2 !== null && signals.construction_m2 !== undefined
          ? signals.construction_m2
          : null,
      floors_count:
        signals.floors_count !== null && signals.floors_count !== undefined
          ? signals.floors_count
          : null,
      garage_spaces:
        signals.garage_spaces !== null && signals.garage_spaces !== undefined
          ? signals.garage_spaces
          : null,
      has_terrace_patio:
        signals.has_terrace_patio !== null && signals.has_terrace_patio !== undefined
          ? signals.has_terrace_patio
          : null,
      occupancy_status: signals.occupancy_status || null,
      occupancy_duration_text: signals.occupancy_duration_text || null,
      occupancy_entry_mode: signals.occupancy_entry_mode || null,
      heirs_relation: signals.heirs_relation || null,
      can_share_documents:
        signals.can_share_documents !== null && signals.can_share_documents !== undefined
          ? signals.can_share_documents
          : null,
      legal_deeded:
        signals.legal_deeded !== null && signals.legal_deeded !== undefined
          ? signals.legal_deeded
          : null,
      has_mortgage:
        signals.has_mortgage !== null && signals.has_mortgage !== undefined
          ? signals.has_mortgage
          : null,
      mortgage_balance_text: signals.mortgage_balance_text || null,
      works_with_realtor:
        signals.works_with_realtor !== null && signals.works_with_realtor !== undefined
          ? signals.works_with_realtor
          : null,
      exclusivity_type: signals.exclusivity_type || null,
      expected_price:
        signals.expected_price !== null && signals.expected_price !== undefined
          ? signals.expected_price
          : null,
      sale_motivation: signals.sale_motivation || null,
      urgency_level: signals.urgency_level || null,
      is_exploring_sale:
        signals.is_exploring_sale !== null && signals.is_exploring_sale !== undefined
          ? signals.is_exploring_sale
          : null,
      accepted_visit:
        signals.accepted_visit !== null && signals.accepted_visit !== undefined
          ? signals.accepted_visit
          : null,
      asks_commission: !!signals.asks_commission,
      asks_only_valuation: !!signals.asks_only_valuation,
      asks_valuation: !!signals.asks_valuation,
      objection_higher_other_agency: !!signals.objection_higher_other_agency,
      objection_no_exclusivity: !!signals.objection_no_exclusivity,
      objection_existing_realtor: !!signals.objection_existing_realtor,
      asks_direct_purchase: !!signals.asks_direct_purchase,
      urgent_sale_signal: !!signals.urgent_sale_signal,
      sell_buy_bridge: !!signals.sell_buy_bridge,
      investor_profile: !!signals.investor_profile,
      remote_client: !!signals.remote_client,
      complaint_followup: !!signals.complaint_followup,
      low_info_campaign_message: !!signals.low_info_campaign_message,
      non_real_estate_or_provider: !!signals.non_real_estate_or_provider,
      seller_scenarios: Array.isArray(signals.seller_scenarios) ? signals.seller_scenarios : [],
      primary_seller_scenario: signals.primary_seller_scenario || null,
      legal_sensitive: !!signals.legal_sensitive,
      already_listed:
        signals.already_listed !== null && signals.already_listed !== undefined
          ? signals.already_listed
          : null,
      listing_duration_days:
        signals.listing_duration_days !== null && signals.listing_duration_days !== undefined
          ? signals.listing_duration_days
          : null,
      has_documents:
        signals.has_documents !== null && signals.has_documents !== undefined
          ? signals.has_documents
          : null,
      municipality_text: signals.municipality_text || null,
      neighborhood_text: signals.neighborhood_text || null,
      risk_flags: Array.isArray(signals.risk_flags) ? signals.risk_flags : [],
      missing_information: Array.isArray(signals.missing_information) ? signals.missing_information : [],
      needs_specialized_review: !!signals.needs_specialized_review,
      location_any: !!signals.location_any,
      bedrooms_any: !!signals.bedrooms_any,
      wants_human: !!signals.wants_human,
      wants_visit: !!signals.wants_visit,
      shows_high_interest: !!signals.shows_high_interest,
      asks_property_details: !!signals.asks_property_details,
      user_goal: signals.user_goal || null,
      intent_type: signals.intent_type || null,
      intent_changed: !!signals.intent_changed,
      next_step: signals.next_step || null,
      playbook_type: signals.playbook_type || null,
      playbook: signals.playbook || null,
      playbook_step: null,
      confidence: signals.confidence || 'low',
      full_name: signals.full_name || prev.full_name || null,
      owner_relation: signals.owner_relation || null,
      contact_preference: signals.contact_preference || prev.contact_preference || null,
      contact_number_confirmed:
        signals.contact_number_confirmed !== null && signals.contact_number_confirmed !== undefined
          ? signals.contact_number_confirmed
          : prev.contact_number_confirmed,
      intent_version: (prev.intent_version || 1) + 1,
    };
  } else {
    next = {
      ...prev,
      lead_flow: signals.lead_flow || prev.lead_flow,
      operation_type: signals.operation_type || prev.operation_type,
      property_type: signals.property_type || prev.property_type,
      location_text:
        signals.location_text !== null && signals.location_text !== undefined
          ? signals.location_text
          : prev.location_text,
      matched_location_from_catalog:
        signals.matched_location_from_catalog || prev.matched_location_from_catalog,
      budget_max:
        signals.budget_max !== null && signals.budget_max !== undefined
          ? signals.budget_max
          : prev.budget_max,
      budget_currency: signals.budget_currency || prev.budget_currency,
      bedrooms:
        signals.bedrooms !== null && signals.bedrooms !== undefined
          ? signals.bedrooms
          : prev.bedrooms,
      bathrooms:
        signals.bathrooms !== null && signals.bathrooms !== undefined
          ? signals.bathrooms
          : prev.bathrooms,
      terrain_m2:
        signals.terrain_m2 !== null && signals.terrain_m2 !== undefined
          ? signals.terrain_m2
          : prev.terrain_m2,
      construction_m2:
        signals.construction_m2 !== null && signals.construction_m2 !== undefined
          ? signals.construction_m2
          : prev.construction_m2,
      floors_count:
        signals.floors_count !== null && signals.floors_count !== undefined
          ? signals.floors_count
          : prev.floors_count,
      garage_spaces:
        signals.garage_spaces !== null && signals.garage_spaces !== undefined
          ? signals.garage_spaces
          : prev.garage_spaces,
      has_terrace_patio:
        signals.has_terrace_patio !== null && signals.has_terrace_patio !== undefined
          ? signals.has_terrace_patio
          : prev.has_terrace_patio,
      occupancy_status: signals.occupancy_status || prev.occupancy_status,
      occupancy_duration_text: signals.occupancy_duration_text || prev.occupancy_duration_text,
      occupancy_entry_mode: signals.occupancy_entry_mode || prev.occupancy_entry_mode,
      heirs_relation: signals.heirs_relation || prev.heirs_relation,
      can_share_documents:
        signals.can_share_documents !== null && signals.can_share_documents !== undefined
          ? signals.can_share_documents
          : prev.can_share_documents,
      legal_deeded:
        signals.legal_deeded !== null && signals.legal_deeded !== undefined
          ? signals.legal_deeded
          : prev.legal_deeded,
      has_mortgage:
        signals.has_mortgage !== null && signals.has_mortgage !== undefined
          ? signals.has_mortgage
          : prev.has_mortgage,
      mortgage_balance_text: signals.mortgage_balance_text || prev.mortgage_balance_text,
      works_with_realtor:
        signals.works_with_realtor !== null && signals.works_with_realtor !== undefined
          ? signals.works_with_realtor
          : prev.works_with_realtor,
      exclusivity_type: signals.exclusivity_type || prev.exclusivity_type,
      expected_price:
        signals.expected_price !== null && signals.expected_price !== undefined
          ? signals.expected_price
          : prev.expected_price,
      sale_motivation: signals.sale_motivation || prev.sale_motivation,
      urgency_level: signals.urgency_level || prev.urgency_level,
      is_exploring_sale:
        signals.is_exploring_sale !== null && signals.is_exploring_sale !== undefined
          ? signals.is_exploring_sale
          : prev.is_exploring_sale,
      accepted_visit:
        signals.accepted_visit !== null && signals.accepted_visit !== undefined
          ? signals.accepted_visit
          : prev.accepted_visit,
      asks_commission: prev.asks_commission || !!signals.asks_commission,
      asks_only_valuation: prev.asks_only_valuation || !!signals.asks_only_valuation,
      asks_valuation: prev.asks_valuation || !!signals.asks_valuation,
      objection_higher_other_agency:
        prev.objection_higher_other_agency || !!signals.objection_higher_other_agency,
      objection_no_exclusivity:
        prev.objection_no_exclusivity || !!signals.objection_no_exclusivity,
      objection_existing_realtor:
        prev.objection_existing_realtor || !!signals.objection_existing_realtor,
      asks_direct_purchase:
        prev.asks_direct_purchase || !!signals.asks_direct_purchase,
      urgent_sale_signal:
        prev.urgent_sale_signal || !!signals.urgent_sale_signal,
      sell_buy_bridge:
        prev.sell_buy_bridge || !!signals.sell_buy_bridge,
      investor_profile:
        prev.investor_profile || !!signals.investor_profile,
      remote_client:
        prev.remote_client || !!signals.remote_client,
      complaint_followup:
        prev.complaint_followup || !!signals.complaint_followup,
      low_info_campaign_message:
        prev.low_info_campaign_message || !!signals.low_info_campaign_message,
      non_real_estate_or_provider:
        prev.non_real_estate_or_provider || !!signals.non_real_estate_or_provider,
      seller_scenarios: mergeUnique(prev.seller_scenarios, signals.seller_scenarios),
      primary_seller_scenario: signals.primary_seller_scenario || prev.primary_seller_scenario,
      legal_sensitive: prev.legal_sensitive || !!signals.legal_sensitive,
      already_listed:
        signals.already_listed !== null && signals.already_listed !== undefined
          ? signals.already_listed
          : prev.already_listed,
      listing_duration_days:
        signals.listing_duration_days !== null && signals.listing_duration_days !== undefined
          ? signals.listing_duration_days
          : prev.listing_duration_days,
      has_documents:
        signals.has_documents !== null && signals.has_documents !== undefined
          ? signals.has_documents
          : prev.has_documents,
      municipality_text: signals.municipality_text || prev.municipality_text,
      neighborhood_text: signals.neighborhood_text || prev.neighborhood_text,
      risk_flags: mergeUnique(prev.risk_flags, signals.risk_flags),
      missing_information: mergeUnique(prev.missing_information, signals.missing_information),
      needs_specialized_review:
        prev.needs_specialized_review || !!signals.needs_specialized_review,
      full_name: signals.full_name || prev.full_name,
      owner_relation: signals.owner_relation || prev.owner_relation,
      contact_preference: signals.contact_preference || prev.contact_preference,
      contact_number_confirmed:
        signals.contact_number_confirmed !== null && signals.contact_number_confirmed !== undefined
          ? signals.contact_number_confirmed
          : prev.contact_number_confirmed,
      wants_human: prev.wants_human || !!signals.wants_human,
      wants_visit: prev.wants_visit || !!signals.wants_visit,
      shows_high_interest: prev.shows_high_interest || !!signals.shows_high_interest,
      asks_property_details: prev.asks_property_details || !!signals.asks_property_details,
      user_goal: signals.user_goal || prev.user_goal,
      intent_type: signals.intent_type || prev.intent_type,
      intent_changed: !!signals.intent_changed,
      next_step: signals.next_step || prev.next_step,
      playbook_type: signals.playbook_type || prev.playbook_type,
      playbook: signals.playbook || prev.playbook,
      playbook_step: prev.playbook_step || null,
      confidence: signals.confidence || prev.confidence,
      location_any: prev.location_any,
      bedrooms_any: prev.bedrooms_any,
    };

    if (signals.location_any) {
      next.location_text = null;
      next.location_any = true;
    }

    if (signals.bedrooms_any) {
      next.bedrooms = null;
      next.bedrooms_any = true;
    }

    if (changeType === 'radical_change') {
      next.intent_version = (prev.intent_version || 1) + 1;
      next.last_shown_property_ids = [];
      next.last_search_filters = null;
      next.last_search_result_count = 0;
      next.handoff_ready = false;
      next.handoff_sent = false;
      next.closing_message_sent = false;
      next.playbook_step = null;
    }
  }

  next.last_change_type = changeType;
  return next;
}

module.exports = {
  detectStateChange,
  buildNextState,
};
