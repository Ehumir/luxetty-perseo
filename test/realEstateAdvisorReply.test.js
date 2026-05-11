'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectRealEstateConsultativeFollowUp,
  hasRealEstateAdvisorTurnContext,
  isCandidateTooSimilarToLastOutbound,
  generateAdvisorReplyForRealEstateTurn,
  mergeReplyToString,
} = require('../conversation/realEstateAdvisorReply');
const { isPlaybookStepComplete, getNextPlaybookStep } = require('../conversation/playbooks');
const { appendNameRequestIfNeeded } = require('../conversation/namePrompt');
const { buildDemandReply } = require('../conversation/responseBuilder');

test('detectRealEstateConsultativeFollowUp — publicación y más opciones', () => {
  assert.equal(detectRealEstateConsultativeFollowUp('¿la tienes publicada?', 'demand')?.reason, 'listing_link_public');
  assert.equal(detectRealEstateConsultativeFollowUp('¿Tienes otras opciones?', 'demand')?.reason, 'more_options');
  assert.equal(detectRealEstateConsultativeFollowUp('¿precio?', 'demand')?.reason, 'price_followup');
  assert.ok(!detectRealEstateConsultativeFollowUp('hola', 'demand'));
});

test('hasRealEstateAdvisorTurnContext — demanda con búsqueda previa sin filas en memoria', () => {
  const state = {
    lead_flow: 'demand',
    operation_type: 'sale',
    location_text: 'Cumbres',
    budget_max: 8000000,
    budget_currency: 'MXN',
    last_search_result_count: 1,
    last_shown_property_ids: ['uuid-1'],
  };
  assert.equal(hasRealEstateAdvisorTurnContext(state, []), true);
});

test('isPlaybookStepComplete offer_options_or_agent con resultados previos en estado', () => {
  const state = {
    wants_human: false,
    handoff_ready: false,
    handoff_sent: false,
    last_search_result_count: 1,
    last_shown_property_ids: ['p1'],
  };
  assert.equal(isPlaybookStepComplete('offer_options_or_agent', state, { matchedProperties: [] }), true);
});

test('getNextPlaybookStep demand — sin paso pendiente cuando ya hubo búsqueda', () => {
  const state = {
    lead_flow: 'demand',
    operation_type: 'sale',
    location_text: 'Cumbres',
    budget_max: 8000000,
    last_search_result_count: 1,
    last_shown_property_ids: ['p1'],
  };
  const progress = getNextPlaybookStep(state, { matchedProperties: [] });
  assert.equal(progress.playbook_step, null);
});

test('isCandidateTooSimilarToLastOutbound — template genérico', () => {
  const last =
    'Con esa información puedo orientarte mejor. ¿Prefieres ver opciones disponibles o que un asesor de Luxetty te contacte?';
  assert.equal(isCandidateTooSimilarToLastOutbound(last, last), true);
  assert.equal(
    isCandidateTooSimilarToLastOutbound('Te comparto una opción distinta en San Pedro.', last),
    false
  );
});

test('generateAdvisorReplyForRealEstateTurn — cliente OpenAI inyectado', async () => {
  const fakeClient = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: 'Respuesta consultiva de prueba.' } }],
        }),
      },
    },
  };
  const out = await generateAdvisorReplyForRealEstateTurn(
    {
      user_message: '¿la tienes publicada?',
      recent_messages: [{ role: 'user', content: '8 millones' }],
      current_lead_flow: 'demand',
      synthetic_state: { lead_flow: 'demand', operation_type: 'sale', location_text: 'Cumbres', budget_max: 8e6 },
      last_suggested_property: {
        title: 'Casa demo',
        price: 7500000,
        currency_code: 'MXN',
        zone: 'Puerta de Hierro',
        slug: 'casa-demo',
        listing_id: 'LUX-A0001',
      },
      suggested_properties: [],
      budget: 8000000,
      zone: 'Cumbres',
      operation: 'sale',
      missing_name: true,
      follow_up_reason: 'listing_link_public',
    },
    { openaiClient: fakeClient, model: 'test-model' }
  );
  assert.match(out.text, /consultiva de prueba/);
  assert.equal(out.used_openai_advisor, true);
  assert.equal(out.response_source, 'openai_advisor');
});

test('regresión Cumbres — playbook no bloquea tras búsqueda con resultados en estado', () => {
  const stateAfterBudget = {
    lead_flow: 'demand',
    operation_type: 'sale',
    location_text: 'Cumbres',
    budget_max: 8000000,
    budget_currency: 'MXN',
    last_search_result_count: 1,
    last_shown_property_ids: ['p1'],
    awaiting_field: null,
  };
  const progress = getNextPlaybookStep(stateAfterBudget, { matchedProperties: [] });
  assert.equal(progress.playbook_step, null);
  assert.ok(detectRealEstateConsultativeFollowUp('¿la tienes publicada?', 'demand'));
  assert.ok(detectRealEstateConsultativeFollowUp('¿Tienes otras opciones?', 'demand'));
  assert.equal(hasRealEstateAdvisorTurnContext(stateAfterBudget, []), true);
});

test('appendNameRequestIfNeeded después de buildDemandReply simulado (sin nombre)', () => {
  const state = {
    lead_flow: 'demand',
    operation_type: 'sale',
    location_text: 'Cumbres',
    budget_max: 8000000,
    budget_currency: 'MXN',
    full_name: null,
    awaiting_field: null,
    result_quality: 'strong',
  };
  const properties = [
    {
      title: 'Residencia ejemplo',
      price: 7900000,
      currency_code: 'MXN',
      neighborhood: 'Puerta de Hierro',
      zone: null,
      city: 'Monterrey',
      bedrooms: 4,
      bathrooms: 4,
      parking_spaces: 2,
      slug: 'residencia-ejemplo',
      match_score: 90,
    },
  ];
  const base = buildDemandReply(state, 'minor_update', properties, null);
  const { messages } = appendNameRequestIfNeeded(base, {
    contact: { first_name: 'Cliente' },
    aiState: { ...state, name_prompt_variant_index: 0 },
    recentOutboundTexts: [],
    userInboundText: '8 millones',
    leadFlow: 'demand',
  });
  const merged = mergeReplyToString(messages);
  assert.match(merged, /Puerta de Hierro|Residencia ejemplo/i);
  assert.match(merged, /compartes tu nombre|cómo te llamas|regalas tu nombre/i);
});
