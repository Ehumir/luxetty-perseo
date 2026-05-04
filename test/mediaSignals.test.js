const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildInboundMessageContext,
  buildMediaAcknowledgementReply,
  buildImageVisionContextPrefix,
} = require('../conversation/mediaSignals');
const { detectIntent } = require('../conversation/intent');
const { parseMessageSignals } = require('../conversation/parsers');

test('A) imagen con caption de venta responde sin fingir analisis visual', () => {
  const inbound = buildInboundMessageContext({
    type: 'image',
    image: { caption: 'Quiero vender esta casa en Cumbres' },
  });

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /recib[ií] la imagen/i);
  assert.doesNotMatch(reply, /ya vi la imagen/i);
  assert.doesNotMatch(reply, /se aprecia/i);
});

test('B) imagen sin caption pide aclaracion de tipo sin inventar detalles', () => {
  const inbound = buildInboundMessageContext({
    type: 'image',
    image: { id: 'img-1' },
  });

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /recib[ií] la imagen/i);
  assert.match(reply, /venderla, rentarla o est[aá]s buscando una propiedad similar/i);
  assert.equal(inbound.media.attachment_detected_not_processed, true);
});

test('C) documento legal sensible activa respuesta cauta y canal humano', () => {
  const inbound = buildInboundMessageContext({
    type: 'document',
    document: { filename: 'sentencia_sucesion.pdf', mime_type: 'application/pdf' },
  });

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /lo puedo registrar como referencia/i);
  assert.match(reply, /confirmes por mensaje el punto principal/i);
  assert.equal(inbound.media.legal_or_property_document_candidate, true);
});

test('D) audio sin transcripcion pide resumen en texto', () => {
  const inbound = buildInboundMessageContext({
    type: 'audio',
    audio: { id: 'abc123' },
  });

  assert.equal(inbound.media.audio_without_transcription, true);
  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /recibí tu audio/i);
  assert.match(reply, /frase/i);
  assert.match(reply, /asesor/i);
});

test('E) audio con transcripcion conserva contenido para intencion', () => {
  const inbound = buildInboundMessageContext({
    type: 'audio',
    audio: {
      id: 'aud-1',
      transcription_text: 'Tengo casa en Guadalupe de 160 metros y quiero vender en 4 millones',
    },
  });

  assert.equal(inbound.media.audio_has_transcription, true);
  assert.equal(inbound.transcriptionText, 'Tengo casa en Guadalupe de 160 metros y quiero vender en 4 millones');
  assert.match(inbound.messageText, /Guadalupe/);

  const intent = detectIntent(inbound.messageText, {});
  assert.equal(intent.leadType, 'offer');
});

test('F) ubicacion compartida no inventa colonia y pide siguiente paso', () => {
  const inbound = buildInboundMessageContext({
    type: 'location',
    location: { latitude: 25.6611, longitude: -100.321 },
  });

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /recib[ií] la ubicaci[oó]n/i);
  assert.doesNotMatch(reply, /colonia/i);
});

test('G) sticker y media no compatible regresan fallback honesto', () => {
  const stickerInbound = buildInboundMessageContext({ type: 'sticker', sticker: { id: 'stk-1' } });
  const unsupportedInbound = buildInboundMessageContext({ type: 'unsupported' });

  const stickerReply = buildMediaAcknowledgementReply(stickerInbound.media);
  const unsupportedReply = buildMediaAcknowledgementReply(unsupportedInbound.media);

  assert.match(stickerReply, /recib[ií] tu archivo\/mensaje/i);
  assert.match(unsupportedReply, /recib[ií] tu archivo\/mensaje/i);
  assert.equal(unsupportedInbound.media.unsupported_media, true);
});

test('H) media con caption de venta mantiene intencion de captacion', () => {
  const inbound = buildInboundMessageContext({
    type: 'image',
    image: { caption: 'Quiero vender mi terreno en Apodaca' },
  });

  const intent = detectIntent(inbound.messageText, {});
  const signals = parseMessageSignals(inbound.messageText, { lead_flow: 'offer' }, inbound);

  assert.equal(intent.leadType, 'offer');
  assert.equal(signals.lead_flow, 'offer');
});

test('I) documento con termino legal se marca legal_sensitive desde caption/filename', () => {
  const inbound = buildInboundMessageContext({
    type: 'document',
    document: { filename: 'albacea_y_sucesion.pdf' },
  });

  const signals = parseMessageSignals(inbound.messageText, { lead_flow: 'offer' }, inbound);
  assert.equal(signals.legal_sensitive, true);
});

test('J) interactive y button traducen opcion seleccionada a texto util', () => {
  const interactiveInbound = buildInboundMessageContext({
    type: 'interactive',
    interactive: {
      button_reply: { id: 'btn-visita', title: 'Quiero agendar visita' },
    },
  });

  const buttonInbound = buildInboundMessageContext({
    type: 'button',
    button: { payload: 'asesor_humano' },
  });

  assert.match(interactiveInbound.messageText, /agendar visita/i);
  assert.match(buttonInbound.messageText, /asesor_humano/i);
});

test('K) imagen recibida mantiene ack transparente sin vision real', () => {
  const inbound = buildInboundMessageContext({
    type: 'image',
    image: { id: 'img-2' },
  });

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /recib[ií] la imagen/i);
  assert.match(reply, /venderla, rentarla o est[aá]s buscando una propiedad similar/i);
  assert.doesNotMatch(reply, /revisi[oó]n autom[aá]tica|detect[eé]:/i);
});

test('L) imagen con vision de fachada responde de forma consultiva', () => {
  const inbound = buildInboundMessageContext({
    type: 'image',
    image: { id: 'img-vision-1' },
  });

  inbound.media.image_vision = {
    ok: true,
    status: 'analyzed',
    summary: 'Fachada de casa con cochera.',
    propertySignals: {
      probablePropertyType: 'casa',
      visibleAreaType: 'fachada',
      apparentCondition: 'buena',
      confidence: 0.81,
    },
    suggestedFollowUp: '¿Buscas venderla o rentarla?',
  };

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /ya pude revisar la imagen/i);
  assert.match(reply, /por lo visible/i);
  assert.match(reply, /venderla o rentarla/i);
});

test('M) imagen borrosa con vision no concluyente mantiene limites', () => {
  const inbound = buildInboundMessageContext({
    type: 'image',
    image: { id: 'img-vision-2' },
  });

  inbound.media.image_vision = {
    ok: true,
    status: 'analyzed',
    summary: null,
    propertySignals: {
      probablePropertyType: 'unknown',
      visibleAreaType: 'unknown',
      apparentCondition: 'no_concluyente',
      confidence: 0.2,
    },
    suggestedFollowUp: '¿Buscas vender, rentar o comprar?',
  };

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /no alcanzo a identificar con claridad/i);
  assert.match(reply, /vender|rentar|comprar/i);
  assert.doesNotMatch(reply, /precio|colonia|metros|recamaras/i);
});

test('N) prefijo contextual conecta imagen con flujo de venta activo', () => {
  const prefix = buildImageVisionContextPrefix(
    {
      image_vision: {
        ok: true,
      },
    },
    {
      lead_flow: 'offer',
    }
  );

  assert.match(prefix, /imagen me ayuda como referencia/i);
  assert.match(prefix, /vender o rentar/i);
});

test('O) audio consecutivo sin transcripcion usa variacion consultiva', () => {
  const inbound = buildInboundMessageContext({
    type: 'audio',
    audio: { id: 'aud-retry-1' },
  });
  inbound.media.audio_without_transcription_repeat = true;

  const reply = buildMediaAcknowledgementReply(inbound.media);
  assert.match(reply, /sigo recibiendo tus audios/i);
  assert.match(reply, /dato clave/i);
  assert.doesNotMatch(reply, /archivo procesado|lead creado|ticket creado/i);
});
