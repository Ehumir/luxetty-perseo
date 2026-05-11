'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldUseAdvisorForRealEstateTurn } = require('../conversation/realEstateAdvisorReply');
const { appendNameRequestIfNeeded } = require('../conversation/namePrompt');

test('A) Demanda activa — busco casa Cumbres y presupuesto → advisor', () => {
  const r1 = shouldUseAdvisorForRealEstateTurn({
    user_message: 'Hola, busco casa en Cumbres',
    ai_state: {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Cumbres',
      awaiting_field: null,
    },
    signals: { lead_flow: 'demand' },
    suggested_properties: [],
    recent_db_messages: [],
    contact: { first_name: 'Cliente' },
  });
  assert.equal(r1.use, true, r1.reason);

  const r2 = shouldUseAdvisorForRealEstateTurn({
    user_message: '8 millones',
    ai_state: {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Cumbres',
      budget_max: 8000000,
      budget_currency: 'MXN',
      last_search_result_count: 1,
      last_shown_property_ids: ['p1'],
    },
    signals: {},
    suggested_properties: [{ id: 'p1', listing_id: 'LUX-A0001', title: 'Casa', price: 7500000, currency_code: 'MXN', slug: 'casa' }],
    recent_db_messages: [],
    contact: { first_name: 'Cliente' },
  });
  assert.equal(r2.use, true, r2.reason);
});

test('B) Follow-up propiedad — precio, publicada, link, pdf, visita', () => {
  const base = {
    ai_state: {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Cumbres',
      budget_max: 8e6,
      budget_currency: 'MXN',
      last_search_result_count: 1,
      last_shown_property_ids: ['p1'],
    },
    suggested_properties: [{ id: 'p1', listing_id: 'LUX-X', title: 'X', price: 1, currency_code: 'MXN', slug: 'x' }],
    recent_db_messages: [],
    contact: { first_name: 'Cliente' },
  };
  for (const msg of ['precio', 'ubicación', '¿la tienes publicada?', 'pásame el link', '¿tienes pdf?', '¿la puedo ver?']) {
    const r = shouldUseAdvisorForRealEstateTurn({ ...base, user_message: msg });
    assert.equal(r.use, true, `${msg}: ${r.reason}`);
  }
});

test('C) Oferta / valuación — intención en texto', () => {
  const r1 = shouldUseAdvisorForRealEstateTurn({
    user_message: 'Quiero vender mi casa',
    ai_state: {},
    signals: {},
    recent_db_messages: [],
  });
  assert.equal(r1.use, true, r1.reason);

  const r2 = shouldUseAdvisorForRealEstateTurn({
    user_message: 'Quiero valuar mi propiedad',
    ai_state: { lead_flow: 'offer', operation_type: 'sale', location_text: 'San Pedro' },
    signals: {},
    recent_db_messages: [],
  });
  assert.equal(r2.use, true, r2.reason);
});

test('D) Programado — QA, spam, multimedia safety, duplicado', () => {
  assert.equal(
    shouldUseAdvisorForRealEstateTurn({
      user_message: '!reset',
      ai_state: { lead_flow: 'demand', operation_type: 'sale', location_text: 'X', budget_max: 1, budget_currency: 'MXN' },
      signals: { qa_command: true },
      suggested_properties: [{}],
    }).use,
    false
  );
  assert.equal(
    shouldUseAdvisorForRealEstateTurn({
      user_message: 'compra crypto',
      ai_state: { lead_flow: 'demand', operation_type: 'sale', location_text: 'X', budget_max: 1, budget_currency: 'MXN' },
      signals: { non_real_estate: true },
      suggested_properties: [{}],
    }).use,
    false
  );
  assert.equal(
    shouldUseAdvisorForRealEstateTurn({
      user_message: 'hola',
      ai_state: { lead_flow: 'demand', operation_type: 'sale', location_text: 'X', budget_max: 1, budget_currency: 'MXN' },
      media_context: { requires_programmed_safety: true },
      suggested_properties: [{}],
    }).use,
    false
  );
  assert.equal(
    shouldUseAdvisorForRealEstateTurn({
      user_message: 'precio',
      ai_state: { lead_flow: 'demand', operation_type: 'sale', location_text: 'X', budget_max: 1, budget_currency: 'MXN' },
      suggested_properties: [{}],
      skip_advisor_for_literal_property_price: true,
    }).use,
    false
  );
});

test('E) Draft incluye forbidden sobre disponibilidad y PDF', () => {
  const r = shouldUseAdvisorForRealEstateTurn({
    user_message: '¿disponible?',
    ai_state: {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Cumbres',
      budget_max: 8e6,
      budget_currency: 'MXN',
      last_search_result_count: 1,
    },
    suggested_properties: [{ id: 'p1', listing_id: 'LUX-1', title: 'Casa', price: null, slug: null }],
    recent_db_messages: [],
    media_context: {},
  });
  assert.equal(r.use, true);
  const joined = (r.draft?.forbidden_claims || []).join(' ');
  assert.match(joined, /disponibilidad|PDF|documento|precio/i);
});

test('F) Nombre — appendNamePrompt sigue aplicando con contacto placeholder', () => {
  const { messages } = appendNameRequestIfNeeded('Respuesta consultiva simulada del advisor.', {
    contact: { first_name: 'Cliente' },
    aiState: { lead_flow: 'demand', awaiting_field: null, name_prompt_variant_index: 0 },
    recentOutboundTexts: [],
    userInboundText: 'precio',
    leadFlow: 'demand',
  });
  assert.match(String(messages), /nombre|llamas/i);
});
