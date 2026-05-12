const test = require('node:test');
const assert = require('node:assert/strict');

const { parseMessageSignals } = require('../conversation/parsers');
const { detectIntent } = require('../conversation/intent');
const {
  buildDemandReply,
  buildOfferReply,
  buildPropertyPriceReply,
} = require('../conversation/responseBuilder');
const {
  buildInboundMessageContext,
  buildMediaAcknowledgementReply,
  buildImageVisionContextPrefix,
} = require('../conversation/mediaSignals');
const { extractCampaignReferralContext } = require('../services/leadAutomation');

const {
  imageMessage,
  audioMessage,
  voiceMessage,
  documentMessage,
  interactiveButtonMessage,
  interactiveListMessage,
  referralTextMessage,
  contactsMessage,
} = require('./helpers/whatsappFixtures');

test('regression: me interesa esta propiedad detecta comercial y conduce a asesor/visita', () => {
  const text = 'Me interesa esta propiedad LUX-A0453, quiero verla';
  const intent = detectIntent(text, {});
  const signals = parseMessageSignals(text, {
    lead_flow: 'demand',
    intent_type: 'property_interest',
  });

  assert.equal(intent.leadType, 'demand');
  assert.equal(signals.wants_visit, true);
  assert.equal(signals.direct_property_reference, true);

  const reply = buildDemandReply(
    {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-A0453',
      asks_property_details: true,
      full_name: null,
      wants_visit: true,
    },
    'append_info',
    [
      {
        id: 'prop-test-a0453',
        listing_id: 'LUX-A0453',
        neighborhood: 'Cumbres',
        slug: 'casa-cumbres-a0453',
      },
    ],
    'direct_property_code'
  );

  const replyText = Array.isArray(reply) ? reply.join(' ') : reply;
  assert.doesNotMatch(replyText, /soy un bot|no entiendo|no puedo ayudarte/i);
  assert.match(replyText, /visita|asesor|te contacte/i);
});

test('regression: quiero vender mi casa mantiene tono consultivo', () => {
  const text = 'Quiero vender mi casa';
  const intent = detectIntent(text, {});
  const signals = parseMessageSignals(text, {});

  assert.equal(intent.leadType, 'offer');
  assert.equal(signals.lead_flow, 'offer');

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: null,
      property_type: null,
      full_name: null,
    },
    'new_intent',
    { signals }
  );

  assert.match(reply, /zona|colonia|contacte|asesor/i);
  assert.doesNotMatch(reply, /no puedo ayudarte|soy un bot/i);
});

test('regression: quiero una valuacion se trata como supply y no como compra', () => {
  const text = 'Quiero una valuación de mi casa';
  const intent = detectIntent(text, {});
  const signals = parseMessageSignals(text, {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  assert.equal(intent.leadType, 'offer');
  assert.equal(signals.asks_valuation, true);

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      owner_relation: 'owner',
      location_text: 'Cumbres',
      property_type: 'house',
      full_name: 'Ana',
      contact_preference: null,
    },
    'append_info',
    { signals }
  );

  assert.match(reply, /comparativ|comparables|asesor|llamada|visita breve/i);
  assert.doesNotMatch(reply, /comprar|buscar opciones/i);
});

test('regression: precio con propiedad usa contexto y siguiente paso', () => {
  const reply = buildPropertyPriceReply(
    {
      id: 'x',
      listing_id: 'LUX-A0460',
      price: 3200000,
    },
    { property_code: 'LUX-A0460' }
  );

  assert.match(reply, /LUX-A0460/);
  assert.match(reply, /3[., ]?200[., ]?000|3,200,000/i);
  assert.match(reply, /asesor/i);
  assert.doesNotMatch(reply, /no entiendo|soy un bot/i);
});

test('regression: referral/campana conserva contexto para orientacion', () => {
  const referralPayload = {
    source_type: 'ad',
    source_id: 'src-22',
    source_url: 'https://facebook.com/ads/test?utm_source=meta&utm_campaign=camp-cumbres',
    campaign_id: 'cmp-22',
    ad_id: 'ad-22',
  };

  const message = referralTextMessage('Hola, vi el anuncio y me interesa', referralPayload);
  const extracted = extractCampaignReferralContext({
    referral: message.referral,
    messageText: message.text.body,
  });

  assert.equal(extracted.hasCampaignContext, true);
  assert.equal(extracted.campaignContext.campaign_id, 'cmp-22');
  assert.equal(extracted.campaignContext.ad_id, 'ad-22');
});

test('regression: imagen usa fallback transparente sin afirmar vision', () => {
  const inbound = buildInboundMessageContext(imageMessage({ id: 'img-qa-1' }));

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /recib[ií] la imagen/i);
  assert.match(reply, /venderla, rentarla o est[aá]s buscando una propiedad similar/i);
  assert.doesNotMatch(reply, /revisi[oó]n autom[aá]tica|ya vi tu imagen|conclusi[oó]n definitiva/i);
});

test('regression: imagen con falla de descarga mantiene fallback transparente', () => {
  const inbound = buildInboundMessageContext(imageMessage({ id: 'img-qa-2' }));
  inbound.media.media_downloaded = false;
  inbound.media.media_download_error = 'whatsapp_media_download_failed';

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /no pude descargarlo correctamente/i);
  assert.match(reply, /reenviar|resumir en texto/i);
  assert.doesNotMatch(reply, /ya vi la imagen|an[aá]lisis completo|escuch[eé] completo/i);
});

test('regression: audio y voice sin transcripcion no fingen escucha', () => {
  const inboundAudio = buildInboundMessageContext(audioMessage({ id: 'aud-qa-1' }));
  const inboundVoice = buildInboundMessageContext(voiceMessage({ id: 'voc-qa-1' }));

  const audioReply = buildMediaAcknowledgementReply(inboundAudio.media);
  const voiceReply = buildMediaAcknowledgementReply(inboundVoice.media);

  assert.equal(inboundAudio.media.audio_without_transcription, true);
  assert.equal(inboundVoice.media.audio_without_transcription, true);
  assert.match(audioReply, /recib[ií] tu audio/i);
  assert.match(voiceReply, /recib[ií] tu audio/i);
  assert.doesNotMatch(audioReply, /ya escuch[eé]|transcrib[ií] completo/i);
});

test('regression: documento no afirma lectura documental completa', () => {
  const inbound = buildInboundMessageContext(
    documentMessage({ filename: 'escritura.pdf', mime_type: 'application/pdf' })
  );

  const reply = buildMediaAcknowledgementReply(inbound.media);

  assert.match(reply, /recib[ií] el documento/i);
  assert.match(reply, /registrar como referencia/i);
  assert.doesNotMatch(reply, /ya le[ií] tu documento|documento analizado al 100/i);
});

test('regression: interactive button/list y contacts generan texto util no robotico', () => {
  const buttonInbound = buildInboundMessageContext(interactiveButtonMessage({ title: 'Quiero visita' }));
  const listInbound = buildInboundMessageContext(interactiveListMessage({ title: 'Ver rentas' }));
  const contactsInbound = buildInboundMessageContext(contactsMessage({ formattedName: 'Carlos Ruiz' }));

  assert.match(buttonInbound.messageText, /Quiero visita/i);
  assert.match(listInbound.messageText, /Ver rentas/i);
  assert.match(contactsInbound.messageText, /comparti[oó] contactos/i);
});

test('regression: imagen con caption de venta conserva intencion de captacion', () => {
  const inbound = buildInboundMessageContext(
    imageMessage({
      id: 'img-cap-1',
      caption: 'Quiero vender esta casa en Cumbres',
    })
  );

  const signals = parseMessageSignals(inbound.messageText, { lead_flow: null }, inbound);
  assert.equal(signals.lead_flow, 'offer');
  assert.equal(signals.operation_type, 'sale');
});

test('regression: imagen despues de audio de venta mantiene continuidad de caso', () => {
  const prefix = buildImageVisionContextPrefix(
    {
      image_vision: { ok: true },
    },
    {
      lead_flow: 'offer',
      intent_type: 'supply',
      last_audio_transcription: 'quiero vender mi casa en cumbres',
    }
  );

  assert.match(prefix, /referencia de la propiedad/i);
  assert.match(prefix, /vender o rentar/i);
});

test('regression: imagen no concluyente no inventa precio ni colonia ni metros', () => {
  const inbound = buildInboundMessageContext(imageMessage({ id: 'img-blurry-1' }));
  inbound.media.image_vision = {
    ok: true,
    status: 'analyzed',
    propertySignals: {
      visibleAreaType: 'unknown',
      probablePropertyType: 'unknown',
      apparentCondition: 'no_concluyente',
      confidence: 0.2,
    },
    suggestedFollowUp: '¿Buscas vender, rentar o comprar?',
  };

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.doesNotMatch(reply, /precio|colonia|metros|rec[aá]maras|ba[nñ]os/i);
});
