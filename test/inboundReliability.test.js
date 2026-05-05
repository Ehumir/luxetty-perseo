const test = require('node:test');
const assert = require('node:assert/strict');

const { parseMessageSignals } = require('../conversation/parsers');
const { buildOfferReply, buildDemandReply } = require('../conversation/responseBuilder');
const {
  consolidateInboundBurst,
  applyConversationIntentMemory,
  chooseSingleUsefulQuestion,
  detectComplaintCorrection,
} = require('../conversation/inboundReliability');

test('Caso A: rafaga de mensajes se consolida y conserva venta + Cumbres', () => {
  const burst = [
    {
      message: {
        id: 'wamid-1',
        timestamp: '1710000000',
        type: 'text',
        text: { body: 'Hola' },
      },
    },
    {
      message: {
        id: 'wamid-2',
        timestamp: '1710000001',
        type: 'text',
        text: { body: 'Quiero vender mi casa' },
      },
    },
    {
      message: {
        id: 'wamid-3',
        timestamp: '1710000002',
        type: 'text',
        text: { body: 'Esta en Cumbres' },
      },
    },
  ];

  const consolidated = consolidateInboundBurst(burst);
  const signals = parseMessageSignals(consolidated.combinedText || '', {});

  assert.equal(consolidated.items.length, 3);
  assert.match(consolidated.combinedText, /quiero vender mi casa/i);
  assert.match(consolidated.combinedText, /cumbres/i);
  assert.equal(signals.lead_flow, 'offer');
  assert.equal(signals.operation_type, 'sale');
  assert.match(String(signals.location_text || ''), /cumbres/i);
});

test('Caso B: venta clara no debe mezclar renta en respuesta', () => {
  const message = 'Quiero vender mi casa en Cumbres';
  const signals = parseMessageSignals(message, {});
  const nextState = {
    lead_flow: 'offer',
    operation_type: 'sale',
    location_text: 'Cumbres',
    property_type: null,
    full_name: null,
  };

  applyConversationIntentMemory({
    text: message,
    previousAiState: {},
    incomingSignals: signals,
    nextAiState: nextState,
  });

  const reply = buildOfferReply(nextState, 'append_info', { signals });

  assert.equal(nextState.intent_lock_sale_owner, true);
  assert.equal(nextState.lead_role, 'owner');
  assert.doesNotMatch(reply, /comprar o rentar|venderla o rentarla|poner en renta/i);
});

test('Caso C: reclamo de no entendiste corrige y mantiene venta', () => {
  const message = 'Por que renta? No entendiste, dije vender';
  const prev = {
    lead_flow: 'offer',
    operation_type: 'sale',
    intent_lock_sale_owner: true,
    location_text: 'Cumbres',
    property_type: null,
  };
  const signals = parseMessageSignals(message, prev);
  const next = { ...prev };

  const reliability = applyConversationIntentMemory({
    text: message,
    previousAiState: prev,
    incomingSignals: signals,
    nextAiState: next,
  });

  const question = chooseSingleUsefulQuestion(next);

  assert.equal(detectComplaintCorrection(message), true);
  assert.equal(reliability.isComplaintCorrection, true);
  assert.equal(next.operation_type, 'sale');
  assert.equal(next.lead_flow, 'offer');
  assert.match(question, /casa|departamento|terreno|zona|precio|nombre/i);
  assert.doesNotMatch(question, /renta|rentar/i);
});

test('Caso D: demanda de renta con presupuesto y zona no cae en propiedad inexistente', () => {
  const merged = 'Busco casa de renta\nPresupuesto 2500\nEn Guadalupe';
  const signals = parseMessageSignals(merged, {});

  assert.equal(signals.lead_flow, 'demand');
  assert.equal(signals.operation_type, 'rent');
  assert.equal(signals.budget_max, 2500);
  assert.match(String(signals.location_text || ''), /guadalupe/i);

  const reply = buildDemandReply(
    {
      lead_flow: 'demand',
      operation_type: 'rent',
      location_text: 'Guadalupe',
      budget_max: 2500,
      property_code: null,
      direct_property_reference: false,
    },
    'append_info',
    [],
    null
  );

  const replyText = Array.isArray(reply) ? reply.join(' ') : reply;
  assert.doesNotMatch(replyText, /no encontr[eé] esa propiedad/i);
});

test('Caso E/F: rafaga en menos de 5s deduplica meta_message_id y deja un solo lote util', () => {
  const burst = [
    {
      message: {
        id: 'wamid-10',
        timestamp: '1710001000',
        type: 'text',
        text: { body: 'Busco renta' },
      },
    },
    {
      message: {
        id: 'wamid-11',
        timestamp: '1710001001',
        type: 'text',
        text: { body: 'presupuesto 2500' },
      },
    },
    {
      message: {
        id: 'wamid-11',
        timestamp: '1710001001',
        type: 'text',
        text: { body: 'presupuesto 2500' },
      },
    },
    {
      message: {
        id: 'wamid-12',
        timestamp: '1710001002',
        type: 'text',
        text: { body: 'en Guadalupe' },
      },
    },
  ];

  const consolidated = consolidateInboundBurst(burst);

  assert.equal(consolidated.items.length, 3);
  assert.deepEqual(
    consolidated.inboundBatch.map((item) => item.meta_message_id),
    ['wamid-10', 'wamid-11', 'wamid-12']
  );
  assert.match(consolidated.combinedText, /busco renta/i);
  assert.match(consolidated.combinedText, /guadalupe/i);
});
