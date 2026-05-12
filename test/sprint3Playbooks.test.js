const test = require('node:test');
const assert = require('node:assert/strict');

const { parseMessageSignals } = require('../conversation/parsers');
const { detectIntent } = require('../conversation/intent');
const {
  buildOfferReply,
  buildDemandReply,
  buildLowInfoCampaignReply,
} = require('../conversation/responseBuilder');
const {
  buildInboundMessageContext,
  buildMediaAcknowledgementReply,
} = require('../conversation/mediaSignals');

test('1) quiero valuar mi casa en cumbres detecta valuacion y responde consultivo', () => {
  const message = 'Quiero valuar mi casa en Cumbres';
  const signals = parseMessageSignals(message, {});

  assert.equal(signals.lead_flow, 'offer');
  assert.equal(signals.asks_valuation, true);

  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', asks_valuation: true, location_text: 'cumbres' },
    'append_info',
    { signals }
  );

  assert.match(reply, /comparativo de mercado/i);
  assert.match(reply, /cumbres|garcia|san pedro|carretera nacional/i);
});

test('2) me urge vender mi casa detecta urgencia y evita promesa de venta inmediata', () => {
  const message = 'Me urge vender mi casa';
  const signals = parseMessageSignals(message, { lead_flow: 'offer' });

  assert.equal(signals.urgent_sale_signal, true);
  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', urgent_sale_signal: true },
    'append_info',
    { signals }
  );

  assert.match(reply, /precio y estrategia/i);
  assert.match(reply, /papeleria/i);
  assert.doesNotMatch(reply, /venta inmediata|garantizada/i);
});

test('3) objecion de comision responde por valor y no defensivo', () => {
  const message = 'Se me hace mucho la comision';
  const signals = parseMessageSignals(message, { lead_flow: 'offer' });
  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale' },
    'append_info',
    { signals }
  );

  assert.match(reply, /neto te queda/i);
  assert.match(reply, /publicada|evaluando vender/i);
});

test('4) no quiero exclusiva reconoce objecion y avanza', () => {
  const message = 'No quiero exclusiva';
  const signals = parseMessageSignals(message, { lead_flow: 'offer' });

  assert.equal(signals.objection_no_exclusivity, true);
  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale' },
    'append_info',
    { signals }
  );

  assert.match(reply, /es valido/i);
  assert.match(reply, /promoviendo con alguien/i);
});

test('5) vender y comprar detecta estrategia puente', () => {
  const message = 'Quiero vender mi casa y comprar otra';
  const signals = parseMessageSignals(message, { lead_flow: 'offer' });

  assert.equal(signals.sell_buy_bridge, true);
  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', sell_buy_bridge: true },
    'append_info',
    { signals }
  );

  assert.match(reply, /revisar ambas cosas/i);
  assert.match(reply, /zona te gustaría buscar/i);
  assert.match(reply, /presupuesto aproximado/i);
});

test('6) inversionista detecta perfil y pregunta criterio de retorno', () => {
  const message = 'Busco casa para invertir';
  const signals = parseMessageSignals(message, { lead_flow: 'demand', operation_type: 'sale' });

  assert.equal(signals.investor_profile, true);
  const reply = buildDemandReply(
    { lead_flow: 'demand', operation_type: 'sale', investor_profile: true },
    'append_info',
    [],
    null
  );

  assert.match(reply, /liquidez/i);
  assert.match(reply, /flujo por renta o plusvalia/i);
  assert.doesNotMatch(reply, /rendimiento garantizado/i);
});

test('7) cliente remoto detecta foraneo y confirma canal', () => {
  const message = 'Vivo en Estados Unidos, quiero vender una casa en Monterrey';
  const signals = parseMessageSignals(message, { lead_flow: 'offer' });

  assert.equal(signals.remote_client, true);
  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', remote_client: true },
    'append_info',
    { signals }
  );

  assert.match(reply, /forma remota|videollamada/i);
  assert.match(reply, /mejor numero para contactarte/i);
});

test('8) reclamo de seguimiento pausa tono comercial y escala', () => {
  const message = 'No me han contestado';
  const signals = parseMessageSignals(message, {});

  assert.equal(signals.complaint_followup, true);
  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', complaint_followup: true },
    'append_info',
    { signals }
  );

  assert.match(reply, /tienes razon/i);
  assert.match(reply, /seguimiento humano|retomar/i);
});

test('9) info de pauta usa variante con y sin contexto', () => {
  const signals = parseMessageSignals('Info', {});
  assert.equal(signals.low_info_campaign_message, true);

  const withCampaign = buildLowInfoCampaignReply(true);
  const withoutCampaign = buildLowInfoCampaignReply(false);

  assert.match(withCampaign, /anuncio que viste/i);
  assert.match(withoutCampaign, /con gusto te ayudo/i);
  assert.match(withoutCampaign, /comprar, rentar, vender o poner en renta/i);
});

test('10) quiero verla con propiedad identificada avanza sin reiniciar filtros', () => {
  const intent = detectIntent('Quiero verla LUX-A0453', {});
  assert.equal(intent.type, 'property_interest');

  const reply = buildDemandReply(
    {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-A0453',
      wants_visit: true,
      full_name: null,
    },
    'append_info',
    [
      {
        listing_id: 'LUX-A0453',
        neighborhood: 'Monterrey',
        slug: 'casa-en-monterrey-a0453',
      },
    ],
    'direct_property_code'
  );

  assert.ok(Array.isArray(reply));
  assert.match(reply[2], /me compartes tu nombre/i);
  assert.doesNotMatch(reply[2], /presupuesto|zona/i);
});

test('11) credito vigente responde con cautela y pide contexto minimo', () => {
  const message = 'Todavia debo al banco';
  const signals = parseMessageSignals(message, { lead_flow: 'offer', operation_type: 'sale' });

  assert.equal(signals.has_mortgage, true);
  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', has_mortgage: true, mortgage_balance_text: null },
    'append_info',
    { signals }
  );

  assert.match(reply, /se puede revisar/i);
  assert.match(reply, /cr[ée]dito est[áa] al corriente/i);
  assert.doesNotMatch(reply, /aprobado|garantizado/i);
});

test('12) imagen con caption vendedor activa oferta por caption sin fingir vision', () => {
  const inbound = buildInboundMessageContext({
    type: 'image',
    image: { caption: 'quiero vender esta casa' },
  });

  const intent = detectIntent(inbound.messageText, {});
  const reply = buildMediaAcknowledgementReply(inbound.media);

  assert.equal(intent.leadType, 'offer');
  assert.match(reply, /recib[ií] la imagen/i);
  assert.doesNotMatch(reply, /ya vi la imagen|analice|analic[eé]/i);
});

test('13) audio sin transcripcion mantiene fallback honesto', () => {
  const inbound = buildInboundMessageContext({
    type: 'audio',
    audio: { id: 'aud-no-tx' },
  });

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.equal(inbound.media.audio_without_transcription, true);
  assert.match(reply, /recib[ií] tu audio/i);
  assert.match(reply, /frase/i);
  assert.match(reply, /asesor/i);
  assert.doesNotMatch(reply, /escuche|escuch[eé]/i);
});

test('14) documento con sucesion activa legal-sensitive sin afirmar lectura documental', () => {
  const inbound = buildInboundMessageContext({
    type: 'document',
    document: { filename: 'sucesion_casa.pdf', caption: 'es un caso de sucesion' },
  });

  const signals = parseMessageSignals(inbound.messageText, { lead_flow: 'offer', operation_type: 'sale' }, inbound);
  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', legal_sensitive: true },
    'append_info',
    { signals }
  );

  assert.equal(signals.legal_sensitive, true);
  assert.doesNotMatch(reply, /lei tu documento|analice tu documento/i);
});

test('15) respuesta corta si tras confirmacion de contacto avanza contextual', () => {
  const stepReply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Monterrey',
      property_type: 'house',
      terrain_m2: 180,
      construction_m2: 240,
      bedrooms: 3,
      bathrooms: 3,
      occupancy_status: 'occupied',
      floors_count: 2,
      garage_spaces: 2,
      has_terrace_patio: true,
      legal_deeded: true,
      has_mortgage: false,
      works_with_realtor: false,
      exclusivity_type: 'open',
      expected_price: 5900000,
      sale_motivation: 'cambio de ciudad',
      urgency_level: 'medium',
      accepted_visit: true,
      full_name: 'Ana Perez',
      contact_preference: 'whatsapp',
      contact_number_confirmed: null,
    },
    'append_info',
    { signals: {} }
  );

  assert.match(stepReply, /mejor n[úu]mero para contactarte/i);

  const yesSignals = parseMessageSignals('si', { awaiting_field: 'contact_number_confirmed' });
  assert.equal(yesSignals.contact_number_confirmed, true);
});
