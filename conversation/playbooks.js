const playbooks = {
  rent_search: [
    'ask_rent_property_type',
    'ask_rent_zone',
    'ask_rent_budget',
    'ask_rent_move_in_date',
    'ask_rent_people_count',
    'ask_rent_pets',
    'ask_rent_special_requirements',
    'offer_options_or_agent',
  ],
  demand: [
    'ask_budget',
    'ask_zone',
    'offer_options_or_agent',
  ],
  supply: [
    'ask_property_type',
    'ask_location',
    'ask_price_expectation',
    'offer_agent',
  ],
  property_interest: [
    'confirm_interest',
    'offer_visit_or_questions',
    'push_agent',
  ],
};

function getPlaybookTypeFromIntent(intent = {}) {
  if (intent.type === 'property_interest' || intent.intent === 'property_interest') return 'property_interest';
  if (intent.type === 'supply' || intent.intent === 'supply' || intent.leadType === 'offer') return 'supply';
  if (intent.type === 'demand' || intent.intent === 'demand' || intent.leadType === 'demand') return 'demand';
  return null;
}

function getPlaybookTypeFromState(state = {}) {
  if (state.playbook_type && playbooks[state.playbook_type]) return state.playbook_type;

  if (state.lead_flow === 'demand' && state.operation_type === 'rent') return 'rent_search';

  if (
    state.direct_property_reference ||
    state.property_code ||
    state.direct_property_code ||
    state.wants_visit ||
    state.shows_high_interest ||
    state.asks_property_details
  ) {
    return 'property_interest';
  }

  if (state.lead_flow === 'offer') return 'supply';
  if (state.lead_flow === 'demand') return 'demand';

  return null;
}

function getPlaybookForIntent(intent = {}) {
  const type = getPlaybookTypeFromIntent(intent);
  return type ? playbooks[type] || null : null;
}

function isPlaybookStepComplete(step, state = {}, context = {}) {
  const hasResults = Array.isArray(context.matchedProperties) && context.matchedProperties.length > 0;

  if (step === 'ask_rent_property_type') return !!state.property_type;
  if (step === 'ask_rent_zone') return !!state.location_text || !!state.location_any;
  if (step === 'ask_rent_budget') return state.budget_max != null;
  if (step === 'ask_rent_move_in_date') return !!state.rental_move_in_date || !!state.timeline_text;
  if (step === 'ask_rent_people_count') return state.rental_people_count != null;
  if (step === 'ask_rent_pets') return state.rental_pets != null;
  if (step === 'ask_rent_special_requirements') return !!state.rental_special_requirements;

  if (step === 'ask_budget') return state.budget_max != null;
  if (step === 'ask_zone') return !!state.location_text || !!state.location_any;
  if (step === 'offer_options_or_agent') {
    const hadPriorResults =
      Number(state.last_search_result_count || 0) > 0 ||
      (Array.isArray(state.last_shown_property_ids) && state.last_shown_property_ids.length > 0);
    return (
      hasResults ||
      hadPriorResults ||
      !!state.wants_human ||
      !!state.handoff_ready ||
      !!state.handoff_sent
    );
  }

  if (step === 'ask_property_type') return !!state.property_type;
  if (step === 'ask_location') return !!state.location_text;
  if (step === 'ask_price_expectation') return state.budget_max != null;
  if (step === 'offer_agent') return !!state.wants_human || !!state.handoff_ready || !!state.handoff_sent || !!state.contact_preference;

  if (step === 'confirm_interest') return !!state.shows_high_interest || !!state.wants_visit || !!state.asks_property_details || !!state.direct_property_reference;
  if (step === 'offer_visit_or_questions') return !!state.wants_visit || !!state.asks_property_details || !!state.wants_human;
  if (step === 'push_agent') return !!state.handoff_ready || !!state.handoff_sent || !!state.awaiting_field;

  return false;
}

function getNextPlaybookStep(state = {}, context = {}) {
  const type = context.playbookType || getPlaybookTypeFromState(state);
  const playbook = type ? playbooks[type] || null : null;

  if (!type || !playbook) {
    return {
      playbook_type: null,
      playbook: null,
      playbook_step: null,
    };
  }

  const nextStep = playbook.find((step) => !isPlaybookStepComplete(step, state, context)) || null;

  return {
    playbook_type: type,
    playbook,
    playbook_step: nextStep,
  };
}

function getPlaybookAwaitingField(step) {
  if (step === 'ask_rent_property_type') return 'property_type';
  if (step === 'ask_rent_zone') return 'location_text';
  if (step === 'ask_rent_budget') return 'budget_max';
  if (step === 'ask_rent_move_in_date') return 'rental_move_in_date';
  if (step === 'ask_rent_people_count') return 'rental_people_count';
  if (step === 'ask_rent_pets') return 'rental_pets';
  if (step === 'ask_rent_special_requirements') return 'rental_special_requirements';
  if (step === 'ask_budget' || step === 'ask_price_expectation') return 'budget_max';
  if (step === 'ask_zone' || step === 'ask_location') return 'location_text';
  if (step === 'ask_property_type') return 'property_type';
  if (step === 'push_agent') return 'full_name';
  return null;
}

function buildPlaybookReply(step, state = {}) {
  const operationType = state.operation_type;

  if (step === 'ask_rent_property_type') return 'Para orientarte mejor, ¿buscas casa completa, departamento, cuarto u otra opción?';
  if (step === 'ask_rent_zone') return '¿En qué zona te interesa rentar?';
  if (step === 'ask_rent_budget') return '¿Cuál es tu presupuesto mensual aproximado para renta?';
  if (step === 'ask_rent_move_in_date') return '¿Para qué fecha te gustaría mudarte?';
  if (step === 'ask_rent_people_count') return '¿Para cuántas personas sería la renta?';
  if (step === 'ask_rent_pets') return '¿Tienes mascotas o necesitas una opción pet-friendly?';
  if (step === 'ask_rent_special_requirements') return '¿Tienes algún requisito especial para la renta?';

  if (step === 'ask_budget') return '¿Cuál es tu presupuesto aproximado?';
  if (step === 'ask_zone') return '¿En qué zona te interesa buscar?';
  if (step === 'offer_options_or_agent') return 'Con esa información puedo orientarte mejor. ¿Prefieres ver opciones disponibles o que un asesor de Luxetty te contacte?';

  if (step === 'ask_property_type') {
    if (operationType === 'sale') return '¿Qué tipo de propiedad deseas vender?';
    if (operationType === 'rent') return '¿Qué tipo de propiedad deseas poner en renta?';
    return '¿Qué tipo de propiedad deseas vender o poner en renta?';
  }
  if (step === 'ask_location') return '¿En qué zona se encuentra la propiedad?';
  if (step === 'ask_price_expectation') {
    if (operationType === 'sale') return '¿En cuánto te gustaría venderla aproximadamente?';
    if (operationType === 'rent') return '¿En cuánto te gustaría rentarla aproximadamente?';
    return '¿En cuánto te gustaría venderla o rentarla aproximadamente?';
  }
  if (step === 'offer_agent') return 'Con esos datos puedo avanzar. ¿Prefieres que un asesor de Luxetty revise tu propiedad contigo?';

  if (step === 'confirm_interest') return 'Entiendo que te interesa esta propiedad. ¿Deseas verla o tienes alguna pregunta puntual?';
  if (step === 'offer_visit_or_questions') return '¿Deseas coordinar una visita o prefieres resolver alguna duda antes?';
  if (step === 'push_agent') {
    return state.full_name
      ? '¿Prefieres que te contacten por WhatsApp o por llamada?'
      : 'Para canalizarte con un asesor de Luxetty, ¿me compartes tu nombre, por favor?';
  }

  return null;
}

module.exports = {
  playbooks,
  getPlaybookForIntent,
  getPlaybookTypeFromIntent,
  getPlaybookTypeFromState,
  getNextPlaybookStep,
  getPlaybookAwaitingField,
  buildPlaybookReply,
  isPlaybookStepComplete,
};
