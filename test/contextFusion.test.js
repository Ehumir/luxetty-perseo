const test = require('node:test');
const assert = require('node:assert/strict');

const { buildUnifiedConversationContext } = require('../conversation/contextFusion');

test('contextFusion: texto directo venta', () => {
  const result = buildUnifiedConversationContext({
    inboundText: 'Quiero vender mi casa en Cumbres en 6 millones',
    previousAiState: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.normalizedIntent.category, 'sell_property');
  assert.equal(result.propertyOffer.operation, 'venta');
  assert.equal(result.propertyOffer.askingPrice, 6000000);
});

test('contextFusion: audio transcrito venta', () => {
  const result = buildUnifiedConversationContext({
    inboundText: '',
    audioTranscription: 'quiero vender mi departamento en san pedro',
    previousAiState: {},
  });

  assert.equal(result.sourceSignals.hasAudioTranscription, true);
  assert.equal(result.normalizedIntent.category, 'sell_property');
});

test('contextFusion: imagen sola sin intencion', () => {
  const result = buildUnifiedConversationContext({
    imageVision: {
      ok: true,
      summary: 'Fachada de casa',
      propertySignals: { apparentCondition: 'buena' },
    },
    previousAiState: {},
  });

  assert.equal(result.shouldCreateOrUpdateLead, false);
  assert.equal(result.crmAction.action, 'none');
});

test('contextFusion: imagen + caption venta', () => {
  const result = buildUnifiedConversationContext({
    inboundText: 'Quiero vender esta casa',
    caption: 'quiero vender esta casa en cumbres',
    imageVision: {
      ok: true,
      summary: 'Fachada con cochera',
      propertySignals: { apparentCondition: 'regular' },
    },
    previousAiState: {},
  });

  assert.equal(result.normalizedIntent.category, 'sell_property');
  assert.equal(result.shouldCreateOrUpdateLead, true);
});

test('contextFusion: ubicacion despues de intencion venta', () => {
  const result = buildUnifiedConversationContext({
    inboundText: '',
    location: {
      latitude: 25.66,
      longitude: -100.3,
      name: 'Cumbres',
      address: 'Monterrey',
    },
    previousAiState: {
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: 'Cumbres',
    },
    existingLead: { id: 'lead-1' },
  });

  assert.equal(result.normalizedIntent.category, 'sell_property');
  assert.equal(result.crmAction.action, 'update_existing_lead');
  assert.equal(result.propertyOffer.location.lat, 25.66);
});

test('contextFusion: interactive button quiero vender', () => {
  const result = buildUnifiedConversationContext({
    inboundText: 'Quiero vender',
    interactive: { title: 'Quiero vender' },
    previousAiState: {},
  });

  assert.equal(result.sourceSignals.hasInteractive, true);
  assert.equal(result.normalizedIntent.category, 'sell_property');
});

test('contextFusion: campaign/property context con me interesa', () => {
  const result = buildUnifiedConversationContext({
    inboundText: 'Me interesa',
    campaignContext: { campaign_id: 'cmp-1' },
    propertyContext: { listing_id: 'LUX-A0010' },
    previousAiState: {},
  });

  assert.equal(result.sourceSignals.hasCampaignContext, true);
  assert.equal(result.sourceSignals.hasPropertyContext, true);
  assert.equal(result.normalizedIntent.category, 'ask_property_info');
  assert.equal(result.shouldCreateOrUpdateLead, true);
});

test('contextFusion: pregunta de valuacion', () => {
  const result = buildUnifiedConversationContext({
    inboundText: 'En cuanto creen que se vende?',
    previousAiState: {},
  });

  assert.equal(result.normalizedIntent.category, 'valuate_property');
  assert.equal(result.normalizedIntent.requiresHumanAdvisor, true);
});

test('contextFusion: rechazo no interesado', () => {
  const result = buildUnifiedConversationContext({
    inboundText: 'No me interesa, gracias',
    previousAiState: {},
  });

  assert.equal(result.normalizedIntent.category, 'not_interested');
  assert.equal(result.shouldCreateOrUpdateLead, false);
});

test('contextFusion: fusiona datos parciales en secuencia', () => {
  const result = buildUnifiedConversationContext({
    inboundText: 'busco casa en renta en cumbres',
    audioTranscription: 'maximo 20 mil',
    previousAiState: {
      lead_flow: 'demand',
      property_type: 'house',
    },
  });

  assert.equal(result.normalizedIntent.category, 'rent_property');
  assert.equal(result.propertyDemand.operation, 'renta');
  assert.equal(result.propertyDemand.propertyType, 'house');
  assert.ok(result.propertyDemand.budgetMax !== null);
});
