const { normalizeAiState, getDefaultAiState } = require('./aiState');

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
