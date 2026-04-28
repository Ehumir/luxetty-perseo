const playbooks = {
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

  if (step === 'ask_budget') return state.budget_max != null;
  if (step === 'ask_zone') return !!state.location_text || !!state.location_any;
  if (step === 'offer_options_or_agent') return hasResults || !!state.wants_human || !!state.handoff_ready || !!state.handoff_sent;

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
  if (step === 'ask_budget' || step === 'ask_price_expectation') return 'budget_max';
  if (step === 'ask_zone' || step === 'ask_location') return 'location_text';
  if (step === 'ask_property_type') return 'property_type';
  if (step === 'push_agent') return 'full_name';
  return null;
}

function buildPlaybookReply(step, state = {}) {
  if (step === 'ask_budget') return 'Perfecto. ¿Cuál es tu presupuesto aproximado?';
  if (step === 'ask_zone') return 'Perfecto. ¿En qué zona te interesa buscar?';
  if (step === 'offer_options_or_agent') return 'Con eso puedo avanzar. ¿Prefieres que te muestre opciones o que te conecte con un asesor?';

  if (step === 'ask_property_type') return 'Perfecto. ¿Qué tipo de propiedad quieres vender o poner en renta?';
  if (step === 'ask_location') return 'Perfecto. ¿En qué zona está la propiedad?';
  if (step === 'ask_price_expectation') return 'Perfecto. ¿En cuánto te gustaría venderla o rentarla aproximadamente?';
  if (step === 'offer_agent') return 'Con esos datos puedo avanzar. ¿Prefieres que un asesor de Luxetty revise tu propiedad contigo?';

  if (step === 'confirm_interest') return 'Perfecto, entiendo que te interesa esta propiedad. ¿Quieres verla o tienes alguna pregunta puntual?';
  if (step === 'offer_visit_or_questions') return '¿Quieres que coordinemos una visita o prefieres resolver dudas primero?';
  if (step === 'push_agent') {
    return state.full_name
      ? 'Perfecto. ¿Prefieres que te contacten por WhatsApp o por llamada?'
      : 'Claro. Para avanzarte con un asesor, ¿me compartes tu nombre completo?';
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
};
