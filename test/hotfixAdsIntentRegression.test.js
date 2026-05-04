const test = require('node:test');
const assert = require('node:assert/strict');

const { detectIntent } = require('../conversation/intent');
const { parseMessageSignals } = require('../conversation/parsers');
const { buildOfferReply } = require('../conversation/responseBuilder');
const { buildPlaybookReply } = require('../conversation/playbooks');
const { detectStateChange, buildNextState } = require('../conversation/stateUpdater');
const { buildMediaAcknowledgementReply } = require('../conversation/mediaSignals');

test('A) anuncio vendedor en Cumbres mantiene flujo de venta sin mencionar renta', () => {
  const message = 'Vi su anuncio en Cumbres y quiero vender mi casa';

  const intent = detectIntent(message, {});
  const signals = parseMessageSignals(message, {});

  assert.equal(intent.leadType, 'offer');
  assert.equal(signals.operation_type, 'sale');
  assert.match(String(signals.location_text || ''), /cumbres/i);

  const playbookReply = buildPlaybookReply('ask_property_type', {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  assert.match(playbookReply, /vender/i);
  assert.doesNotMatch(playbookReply, /renta|rentar/i);
});

test('B) despues de "7 millones" se toma como precio de venta y continua calificacion', () => {
  const prevState = {
    lead_flow: 'offer',
    operation_type: 'sale',
    owner_relation: 'owner',
    location_text: 'Cumbres',
    property_type: 'house',
  };

  const signals = parseMessageSignals('7 millones', prevState);
  const changeType = detectStateChange(prevState, signals);
  const nextState = buildNextState(prevState, signals, changeType);

  assert.equal(signals.budget_max, 7000000);
  assert.equal(nextState.lead_flow, 'offer');
  assert.equal(nextState.operation_type, 'sale');
  assert.equal(nextState.expected_price, 7000000);

  const reply = buildOfferReply(nextState, changeType, { signals });
  assert.match(reply, /m²|terreno|construcci[oó]n/i);
  assert.doesNotMatch(reply, /renta|rentar/i);
});

test('C) reclamo "no entendiste" activa correccion contextual', () => {
  const message = '¿No entendiste? Te dije que quiero vender';
  const signals = parseMessageSignals(message, { lead_flow: 'offer', operation_type: 'sale' });

  assert.equal(signals.complaint_followup, true);

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      complaint_followup: true,
    },
    'append_info',
    { signals }
  );

  assert.match(reply, /gracias|razon|seguimiento|retomar/i);
  assert.match(reply, /venta|vender/i);
  assert.doesNotMatch(reply, /compra|renta|rentar/i);
});

test('D) fallback de audio con falla de descarga preserva contexto de venta', () => {
  const media = {
    type: 'audio',
    media_download_error: 'whatsapp_media_download_failed',
  };

  const reply = buildMediaAcknowledgementReply(media, {
    aiState: {
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: 'Cumbres',
    },
  });

  assert.match(reply, /audio|archivo/i);
  assert.match(reply, /venta|vender/i);
  assert.match(reply, /cumbres/i);
  assert.doesNotMatch(reply, /compra|renta|rentar/i);
  assert.doesNotMatch(reply, /darme un poco m[aá]s de detalle/i);
});
