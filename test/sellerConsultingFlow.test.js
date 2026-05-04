const test = require('node:test');
const assert = require('node:assert/strict');

const { detectIntent } = require('../conversation/intent');
const { parseMessageSignals } = require('../conversation/parsers');
const { buildOfferReply } = require('../conversation/responseBuilder');
const { buildInboundMessageContext } = require('../conversation/mediaSignals');
const { classifySellerScenarios } = require('../conversation/sellerScenarioClassifier');
const { buildStructuredSellerCrmSummary } = require('../services/leadAutomation');
const fixtures = require('./fixtures/sellerConversations');

function countQuestions(text = '') {
  return (String(text).match(/\?/g) || []).length;
}

test('vendedor estandar detecta intent de oferta con mensaje generico', () => {
  const intent = detectIntent(fixtures.genericSeller.message, {});
  assert.equal(intent.leadType, 'offer');
  assert.equal(intent.operationType, 'sale');
});

test('pregunta compran terrenos se interpreta como captacion y no compra directa', () => {
  const intent = detectIntent(fixtures.buyLandQuestion.message, {});
  assert.equal(intent.leadType, 'offer');
  const signals = parseMessageSignals(fixtures.buyLandQuestion.message, {});
  assert.equal(signals.asks_direct_purchase, true);

  const reply = buildOfferReply({ lead_flow: 'offer', operation_type: 'sale' }, 'append_info', { signals });
  assert.match(reply, /no compramos propiedades directamente/i);
});

test('casa en Puerta de Hierro ya publicada sin resultados activa escenario already listed', () => {
  const signals = parseMessageSignals(fixtures.casePuertaDeHierro.fullContext, {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  const scenario = classifySellerScenarios({
    messageText: fixtures.casePuertaDeHierro.fullContext,
    aiState: { lead_flow: 'offer', operation_type: 'sale', works_with_realtor: true },
    media: { type: 'text' },
  });

  assert.equal(signals.listing_duration_days, 40);
  assert.ok(scenario.scenarios.includes('seller_already_listed'));

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Puerta de Hierro, Monterrey',
      property_type: 'house',
      already_listed: true,
      listing_duration_days: 40,
    },
    'append_info',
    { signals }
  );

  assert.match(reply, /estrategia de precio y posicionamiento/i);
  assert.match(reply, /asesora especialista/i);
});

test('adulto mayor buscando casa mas chica activa escenario senior downsizing', () => {
  const scenario = classifySellerScenarios({
    messageText: fixtures.casePuertaDeHierro.fullContext,
    aiState: { lead_flow: 'offer', operation_type: 'sale' },
    media: { type: 'text' },
  });

  assert.ok(scenario.scenarios.includes('seller_senior_downsizing'));
});

test('propiedad ocupada sin contrato activa legal_sensitive y ocupacion', () => {
  const signals = parseMessageSignals(fixtures.caseLegalSensitiveOccupied.firstMessage, {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  assert.equal(signals.legal_sensitive, true);
  assert.ok((signals.seller_scenarios || []).includes('seller_occupied_property'));
});

test('sucesion/intestado/herederos/poder activa scenario de sucesion', () => {
  const signals = parseMessageSignals(fixtures.caseLegalSensitiveOccupied.legalContext, {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  assert.ok((signals.seller_scenarios || []).includes('seller_inheritance_succession'));
});

test('recepcion de imagen/documento se clasifica con candidatos de propiedad/legal', () => {
  const imageContext = buildInboundMessageContext({
    type: 'image',
    image: { caption: 'fachada de casa en venta' },
  });
  assert.equal(imageContext.media.property_image_candidate, true);

  const documentContext = buildInboundMessageContext({
    type: 'document',
    document: { filename: 'escritura.pdf', mime_type: 'application/pdf' },
  });
  assert.equal(documentContext.media.legal_or_property_document_candidate, true);
});

test('si zona y tipo ya estan, no repite esas preguntas', () => {
  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Monterrey',
      property_type: 'house',
    },
    'append_info',
    { signals: {} }
  );

  assert.doesNotMatch(reply, /¿En qué zona o colonia/i);
  assert.doesNotMatch(reply, /¿Es casa, departamento, terreno o local\?/i);
});

test('respuesta consultiva mantiene maximo 2-3 preguntas por mensaje', () => {
  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Apodaca',
      property_type: 'house',
      legal_sensitive: true,
    },
    'append_info',
    {
      signals: {
        legal_sensitive: true,
      },
    }
  );

  assert.ok(countQuestions(reply) <= 3);
});

test('genera resumen CRM estructurado para ATENA con campos clave', () => {
  const summary = buildStructuredSellerCrmSummary({
    aiState: {
      lead_flow: 'offer',
      full_name: 'Rosa Gomez',
      property_type: 'house',
      location_text: 'Puerta de Hierro',
      municipality_text: 'monterrey',
      neighborhood_text: 'Puerta de Hierro',
      sale_motivation: 'mudanza a casa mas chica',
      already_listed: true,
      listing_duration_days: 40,
      has_documents: true,
      occupancy_status: 'occupied',
      legal_sensitive: false,
      expected_price: 7800000,
      primary_seller_scenario: 'seller_already_listed',
    },
    conversation: { phone: '5218111111111' },
  });

  assert.equal(summary.contact_name, 'Rosa Gomez');
  assert.equal(summary.seller_intent, true);
  assert.equal(summary.zone, 'Puerta de Hierro');
  assert.equal(summary.already_listed, true);
  assert.equal(summary.listing_duration, 40);
  assert.ok(Array.isArray(summary.risk_flags));
  assert.ok(Array.isArray(summary.missing_information));
});
