'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAdvisorResponseDraftContext,
  inferAdvisorMode,
  inferResponseGoal,
  buildForbiddenClaims,
  normalizeRecentMessagesForAdvisor,
} = require('../conversation/advisorDraftContext');

test('1) demanda activa con presupuesto y zona', () => {
  const draft = buildAdvisorResponseDraftContext({
    user_message: 'Busco casa en Cumbres',
    ai_state: {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Cumbres',
      budget_max: 8000000,
      budget_currency: 'MXN',
      awaiting_field: null,
    },
    signals: { lead_flow: 'demand' },
    suggested_properties: [],
  });
  assert.equal(draft.lead_flow, 'demand');
  assert.equal(draft.property_context?.location_text, 'Cumbres');
  assert.equal(draft.property_context?.budget_max, 8000000);
  assert.equal(draft.advisor_mode, 'demand_active');
  assert.ok(Array.isArray(draft.safety_constraints) && draft.safety_constraints.length >= 3);
});

test('2) oferta activa con zona pendiente', () => {
  const draft = buildAdvisorResponseDraftContext({
    user_message: 'Quiero vender',
    ai_state: {
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: null,
      owner_relation: 'owner',
    },
    signals: {},
  });
  assert.equal(draft.lead_flow, 'offer');
  assert.ok(draft.missing_fields.includes('location_text'));
  assert.equal(draft.advisor_mode, 'offer_active');
});

test('3) propiedad sugerida previa', () => {
  const prop = {
    id: 'p-1',
    listing_id: 'LUX-A0001',
    title: 'Residencia',
    neighborhood: 'PH',
    price: 7900000,
    currency_code: 'MXN',
    slug: 'residencia-ph',
  };
  const draft = buildAdvisorResponseDraftContext({
    user_message: '¿Sigue disponible?',
    ai_state: { lead_flow: 'demand', operation_type: 'sale', location_text: 'Cumbres', budget_max: 8e6, budget_currency: 'MXN' },
    last_suggested_property: prop,
    suggested_properties: [prop],
  });
  assert.equal(draft.last_suggested_property?.listing_id, 'LUX-A0001');
  assert.equal(draft.suggested_properties.length, 1);
  assert.equal(draft.response_goal, 'property_followup');
});

test('4) last_shown_property_ids con suggested_properties', () => {
  const props = [
    { id: 'id-1', listing_id: 'LUX-B0001', title: 'A', price: 1, currency_code: 'MXN', slug: 'a' },
  ];
  const draft = buildAdvisorResponseDraftContext({
    user_message: '¿Otra opción?',
    ai_state: {
      lead_flow: 'demand',
      operation_type: 'sale',
      location_text: 'Apodaca',
      budget_max: 5000000,
      budget_currency: 'MXN',
      last_shown_property_ids: ['id-1'],
      last_search_result_count: 1,
    },
    suggested_properties: props,
  });
  assert.deepEqual(draft.property_context?.last_shown_property_ids, ['id-1']);
  assert.equal(draft.suggested_properties[0]?.listing_id, 'LUX-B0001');
  assert.equal(draft.response_goal, 'more_options');
});

test('5) campaña / referral', () => {
  const draft = buildAdvisorResponseDraftContext({
    user_message: 'Hola vengo del anuncio',
    ai_state: { lead_flow: 'demand', operation_type: 'sale' },
    campaign_context: { campaign_type: 'property_listing', property_code: 'LUX-A0900' },
    signals: { lead_flow: 'demand' },
  });
  assert.equal(draft.campaign_context?.property_code, 'LUX-A0900');
  assert.equal(draft.advisor_mode, 'campaign_active');
});

test('6) contacto con nombre válido → should_ask_name false', () => {
  const draft = buildAdvisorResponseDraftContext({
    user_message: 'Gracias',
    ai_state: { lead_flow: 'demand', operation_type: 'sale', full_name: 'María López' },
    contact: { first_name: 'María', last_name: 'López' },
  });
  assert.equal(draft.contact_context.has_valid_name, true);
  assert.equal(draft.contact_context.should_ask_name, false);
  assert.equal(draft.should_ask_name, false);
});

test('7) placeholder Cliente → should_ask_name true', () => {
  const draft = buildAdvisorResponseDraftContext({
    user_message: 'Ok',
    ai_state: { lead_flow: 'demand', operation_type: 'sale', location_text: 'Cumbres', budget_max: 8e6, budget_currency: 'MXN' },
    contact: { first_name: 'Cliente' },
  });
  assert.equal(draft.contact_context.is_placeholder, true);
  assert.equal(draft.contact_context.should_ask_name, true);
  assert.equal(draft.should_ask_name, true);
});

test('8) multimedia sin análisis → forbidden_claims incluye no fingir análisis', () => {
  const draft = buildAdvisorResponseDraftContext({
    user_message: 'Te mando foto',
    ai_state: { lead_flow: 'demand', operation_type: 'sale' },
    media_context: {},
  });
  const joined = draft.forbidden_claims.join(' ');
  assert.match(joined, /imagen|visual|audio|documento/i);
});

test('9) propiedad sin precio confirmado → forbidden_claims precio', () => {
  const claims = buildForbiddenClaims({
    last_suggested_property: { title: 'X', price: null, slug: null },
  });
  assert.ok(claims.some((c) => /precio/i.test(c)));
});

test('10) context null / undefined no revienta', () => {
  assert.doesNotThrow(() => buildAdvisorResponseDraftContext(null));
  assert.doesNotThrow(() => buildAdvisorResponseDraftContext(undefined));
  const d = buildAdvisorResponseDraftContext(null);
  assert.equal(typeof d.user_message, 'string');
  assert.ok(Array.isArray(d.recent_messages));
  assert.equal(d.lead_flow, null);
});

test('normalizeRecentMessagesForAdvisor mapea inbound/outbound', () => {
  const rows = [
    { direction: 'inbound', message_text: 'Hola' },
    { direction: 'outbound', message_text: 'Buen día' },
  ];
  const m = normalizeRecentMessagesForAdvisor(rows);
  assert.deepEqual(m[0], { role: 'user', content: 'Hola' });
  assert.deepEqual(m[1], { role: 'assistant', content: 'Buen día' });
});

test('inferAdvisorMode safety_programmed con flag', () => {
  assert.equal(
    inferAdvisorMode({
      ai_state: {},
      signals: {},
      media_context: { requires_programmed_safety: true },
    }),
    'safety_programmed'
  );
});

test('inferResponseGoal link_or_publication', () => {
  assert.equal(inferResponseGoal('¿tienes pdf del brochure?', { lead_flow: 'demand' }, {}), 'link_or_publication');
});
