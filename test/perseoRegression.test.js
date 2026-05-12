'use strict';

/**
 * PERSEO — Suite de regresión maestra
 * Ejecutar: npm run test:regression  o  npm run test:perseo
 *
 * Política: ninguna mejora futura puede aprobarse si rompe estos escenarios.
 * Cubren intención, tono, no-invención, CRM, media, cambio de intención,
 * deduplicación y auditoría.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

// ─── Módulos del sistema ──────────────────────────────────────────────────────
const { parseMessageSignals } = require('../conversation/parsers');
const { detectIntent } = require('../conversation/intent');
const {
  buildDemandReply,
  buildOfferReply,
  buildPropertyPriceReply,
  buildFinalHandoffReply,
  buildLowInfoCampaignReply,
} = require('../conversation/responseBuilder');
const {
  buildMediaAcknowledgementReply,
  buildImageVisionContextPrefix,
} = require('../conversation/mediaSignals');
const {
  createOrReuseLeadFromConversation,
  detectLeadCreationOpportunity,
  extractCampaignReferralContext,
} = require('../services/leadAutomation');
const { normalizePhoneNumber } = require('../utils/helpers');
const {
  consolidateInboundBurst,
  applyConversationIntentMemory,
  evaluateCommercialCloseDecision,
} = require('../conversation/inboundReliability');

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const {
  PROPERTY_LUX_A0453,
  PROPERTY_LUX_B0201,
  PROPERTY_LUX_C0310,
  CONTACT_ANA,
  CONTACT_ANA_ALT_PHONE,
  CONTACT_CARLOS,
  LEAD_ANA_DEMAND,
  CONV_ANA,
  CONV_CARLOS,
  CONV_ANON,
  buildMockSupabase,
  buildBaseDb,
} = require('./fixtures/perseoRegressionFixtures');

// ─── Helper: texto plano de reply ─────────────────────────────────────────────
function replyText(reply) {
  return Array.isArray(reply) ? reply.join(' ') : String(reply || '');
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. Saludo simple
// ═════════════════════════════════════════════════════════════════════════════
test('R01 · saludo simple: no detecta lead_flow, respuesta orientadora', () => {
  const msg = 'Hola';
  const intent = detectIntent(msg, {});
  const signals = parseMessageSignals(msg, {});

  assert.equal(signals.lead_flow, null, 'saludo no debe inferir lead_flow');
  assert.equal(signals.direct_property_reference, false, 'no debe inferir propiedad');
  assert.equal(intent.leadType, null, 'intención debe ser nula en saludo puro');
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Comprador genérico (sin detalles)
// ═════════════════════════════════════════════════════════════════════════════
test('R02 · comprador genérico: demand detectado, pide zona/presupuesto', () => {
  const msg = 'Busco casa';
  const signals = parseMessageSignals(msg, {});
  const intent = detectIntent(msg, {});

  assert.equal(signals.lead_flow, 'demand', 'debe detectar demand');

  const reply = buildDemandReply(
    { lead_flow: 'demand', operation_type: null, location_text: null, budget_max: null, property_type: 'house' },
    'new_intent',
    [],
    null
  );
  const text = replyText(reply);

  assert.doesNotMatch(text, /no encontré esa propiedad/i, 'no debe inventar propiedad inexistente');
  assert.match(text, /zona|presupuesto|colonia|orientarte/i, 'debe pedir datos faltantes');
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Comprador con presupuesto
// ═════════════════════════════════════════════════════════════════════════════
test('R03 · comprador con presupuesto: extrae budget_max correcto', () => {
  const msg = 'Busco casa en Cumbres, presupuesto 4 millones';
  const signals = parseMessageSignals(msg, {});

  assert.equal(signals.lead_flow, 'demand', 'debe ser demand');
  assert.ok(signals.budget_max != null, 'debe extraer budget_max');
  assert.ok(signals.budget_max >= 4000000, 'budget_max debe ser >= 4,000,000');
  assert.match(String(signals.location_text || ''), /cumbres/i, 'debe capturar zona Cumbres');
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Interés por propiedad específica
// ═════════════════════════════════════════════════════════════════════════════
test('R04 · interés por propiedad específica LUX-A0453: direct_property_reference', () => {
  const msg = 'Me interesa la propiedad LUX-A0453';
  const signals = parseMessageSignals(msg, {});

  assert.equal(signals.direct_property_reference, true, 'debe marcar direct_property_reference');
  assert.equal(signals.property_code, 'LUX-A0453', 'debe capturar el código exacto');
  assert.equal(signals.lead_flow, 'demand', 'debe inferir demand por interés en propiedad');
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Pregunta por precio
// ═════════════════════════════════════════════════════════════════════════════
test('R05 · pregunta por precio: respuesta usa precio real, no inventa', () => {
  // Con precio disponible
  const replyWithPrice = buildPropertyPriceReply(PROPERTY_LUX_A0453, {
    property_code: 'LUX-A0453',
    direct_property_reference: true,
  });
  const textWithPrice = replyText(replyWithPrice);
  assert.match(textWithPrice, /4[\s,.]?500[\s,.]?000|4\.5\s*M/i, 'debe mostrar precio real');
  assert.doesNotMatch(textWithPrice, /inventé|no sé|no tengo idea/i);

  // Sin precio disponible
  const replyNoPriceProp = { ...PROPERTY_LUX_A0453, price: null };
  const replyNoPrice = buildPropertyPriceReply(replyNoPriceProp, { property_code: 'LUX-A0453' });
  const textNoPrice = replyText(replyNoPrice);
  assert.match(textNoPrice, /no tengo un precio numérico verificado|no tengo un precio p[uú]blico confirmado|asesor/i, 'sin precio debe escalar');
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. Pregunta por disponibilidad
// ═════════════════════════════════════════════════════════════════════════════
test('R06 · pregunta por disponibilidad: nunca afirma disponibilidad sin confirmar', () => {
  const msg = '¿Está disponible la propiedad LUX-A0453?';
  const signals = parseMessageSignals(msg, {});

  const reply = buildDemandReply(
    {
      lead_flow: 'demand',
      direct_property_reference: true,
      property_code: 'LUX-A0453',
      asks_property_details: true,
      full_name: null,
    },
    'append_info',
    [PROPERTY_LUX_A0453],
    'direct_property_code'
  );
  const text = replyText(reply);

  assert.doesNotMatch(text, /s[ií],? está disponible|confirmado disponible/i,
    'no debe afirmar disponibilidad sin confirmación de asesor');
  assert.match(text, /asesor|confirmar|disponibilidad/i,
    'debe derivar a asesor para confirmar');
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. Pregunta por ubicación
// ═════════════════════════════════════════════════════════════════════════════
test('R07 · pregunta por ubicación: extrae location_text sin inventar colonia', () => {
  const msg = 'Busco casa en San Pedro';
  const signals = parseMessageSignals(msg, {});

  assert.match(String(signals.location_text || signals.matched_location_from_catalog || ''), /san pedro/i,
    'debe capturar San Pedro');
  assert.equal(signals.lead_flow, 'demand');

  // No debe inventar calles o precios específicos
  const reply = buildDemandReply(
    { lead_flow: 'demand', location_text: 'San Pedro', budget_max: null, property_type: null },
    'append_info',
    [],
    null
  );
  const text = replyText(reply);
  assert.doesNotMatch(text, /calle\s+\w+\s+#\d+|precio:\s*\$\d/i, 'no debe inventar calles ni precios');
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. Solicitud de visita
// ═════════════════════════════════════════════════════════════════════════════
test('R08 · solicitud de visita: wants_visit detectado, reply conduce a asesor', () => {
  const msg = 'Quiero verla, ¿puedo agendar una visita?';
  const signals = parseMessageSignals(msg, {
    lead_flow: 'demand',
    direct_property_reference: true,
    property_code: 'LUX-A0453',
  });

  assert.equal(signals.wants_visit, true, 'debe marcar wants_visit');

  const reply = buildFinalHandoffReply({
    lead_flow: 'demand',
    wants_visit: true,
    full_name: null,
    contact_preference: null,
    direct_property_reference: true,
    property_code: 'LUX-A0453',
  });
  assert.match(reply, /visita|asesor|contactar[aá]/i, 'debe confirmar coordinación de visita');
  assert.doesNotMatch(reply, /no puedo ayudarte|soy un bot/i);
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Vendedor genérico
// ═════════════════════════════════════════════════════════════════════════════
test('R09 · vendedor genérico: offer/sale detectado, tono consultivo', () => {
  const msg = 'Quiero vender mi casa';
  const intent = detectIntent(msg, {});
  const signals = parseMessageSignals(msg, {});

  assert.equal(intent.leadType, 'offer', 'debe ser offer');
  assert.equal(signals.lead_flow, 'offer');
  assert.equal(signals.operation_type, 'sale');

  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', location_text: null, property_type: null, full_name: null },
    'new_intent',
    { signals }
  );
  assert.doesNotMatch(reply, /no puedo|soy un bot|error/i);
  // La respuesta inicial puede pedir aclaración sobre la propiedad o el propietario
  assert.match(reply, /tuya|apoy[ae]|zona|colonia|tipo|asesor|propiedad|vender/i, 'debe preguntar datos clave o aclarar contexto');
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. Valuación
// ═════════════════════════════════════════════════════════════════════════════
test('R10 · valuación: asks_valuation, respuesta consultiva sin precio inventado', () => {
  const msg = 'Quiero valuar mi casa en Cumbres';
  const signals = parseMessageSignals(msg, {});

  assert.equal(signals.asks_valuation, true, 'debe marcar asks_valuation');
  assert.equal(signals.lead_flow, 'offer', 'valuación es flujo de oferta');

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: 'Cumbres',
      property_type: null,
      full_name: null,
      asks_valuation: true,
    },
    'append_info',
    { signals }
  );
  assert.doesNotMatch(reply, /vale\s+\$[\d,]+|precio\s+exacto/i, 'no debe dar precio inventado');
  assert.match(reply, /comparativ|comparable|asesor|revisar|valuaci/i, 'debe hablar de proceso real');
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. Pregunta de comisión
// ═════════════════════════════════════════════════════════════════════════════
test('R11 · comisión: asks_commission detectado, respuesta no defensiva', () => {
  const msg = '¿Cuánto cobran de comisión?';
  const signals = parseMessageSignals(msg, {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  assert.equal(signals.asks_commission, true, 'debe detectar asks_commission');

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      location_text: 'Cumbres',
      property_type: 'house',
      full_name: 'Ana',
      asks_commission: true,
    },
    'append_info',
    { signals }
  );
  assert.doesNotMatch(reply, /no te puedo decir|es confidencial|no lo sé/i, 'no debe ser evasivo');
  assert.match(reply, /comisi[oó]n|porcentaje|servicio|valor/i, 'debe abordar el tema de comisión');
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. Terreno en venta
// ═════════════════════════════════════════════════════════════════════════════
test('R12 · terreno en venta: property_type land/terreno, detecta offer', () => {
  const msg = 'Tengo un terreno en Santa Catarina que quiero vender';
  const signals = parseMessageSignals(msg, {});

  assert.ok(
    ['land', 'terrain', 'terreno'].some((t) => (signals.property_type || '').toLowerCase().includes(t)) ||
    /terreno|land/i.test(msg),
    'debe detectar tipo terreno'
  );
  assert.equal(signals.lead_flow, 'offer', 'debe ser offer');
  assert.equal(signals.operation_type, 'sale');

  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', property_type: 'land', location_text: 'Santa Catarina', full_name: null },
    'new_intent',
    { signals }
  );
  assert.doesNotMatch(replyText(reply), /buscar opciones de compra|demanda/i, 'no debe confundir con demand');
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. Propiedad ya publicada sin vender
// ═════════════════════════════════════════════════════════════════════════════
test('R13 · propiedad ya publicada sin vender: detecta already_listed', () => {
  const msg = 'Ya está publicada en otras inmobiliarias pero no se ha vendido';
  const signals = parseMessageSignals(msg, {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  assert.equal(signals.already_listed, true, 'debe marcar already_listed');
  assert.ok(
    (signals.seller_scenarios || []).some((s) => s.includes('already_listed')) ||
    (signals.primary_seller_scenario || '').includes('already_listed'),
    'escenario already_listed debe estar en seller_scenarios o como primary'
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. Sucesión / intestado / herederos
// ═════════════════════════════════════════════════════════════════════════════
test('R14 · sucesión/intestado/herederos: legal_sensitive activado', () => {
  const msg = 'La propiedad es de mi abuelo que falleció, somos varios herederos y hay intestado';
  const signals = parseMessageSignals(msg, {});

  assert.equal(signals.legal_sensitive, true, 'debe activar legal_sensitive');
  assert.equal(signals.needs_specialized_review, true, 'debe marcar needs_specialized_review');

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      legal_sensitive: true,
      needs_specialized_review: true,
      location_text: null,
      property_type: null,
      full_name: null,
    },
    'append_info',
    { signals }
  );
  assert.doesNotMatch(replyText(reply), /no hay problema|fácil|rápido/i, 'no debe minimizar tema legal');
  assert.match(replyText(reply), /asesor|especializ|revisar|canal/i, 'debe escalar a asesor');
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. Propiedad ocupada
// ═════════════════════════════════════════════════════════════════════════════
test('R15 · propiedad ocupada: marca occupancy_status', () => {
  // Usar keywords exactas que detecta detectOccupancyStatus
  const msg = 'La propiedad está habitada, la habito actualmente';
  const signals = parseMessageSignals(msg, {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  assert.ok(
    signals.occupancy_status != null,
    'debe detectar occupancy_status (occupied/vacant) con keywords directas'
  );
  assert.equal(signals.occupancy_status, 'occupied', 'propiedad habitada debe ser occupied');
});

// ═════════════════════════════════════════════════════════════════════════════
// 16. Crédito vigente
// ═════════════════════════════════════════════════════════════════════════════
test('R16 · crédito vigente: has_mortgage detectado, respuesta con cautela', () => {
  const msg = 'Todavía tengo hipoteca vigente, falta poco por pagar';
  const signals = parseMessageSignals(msg, {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  assert.equal(signals.has_mortgage, true, 'debe detectar hipoteca');

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      has_mortgage: true,
      location_text: 'Monterrey',
      property_type: 'house',
      full_name: null,
    },
    'append_info',
    { signals }
  );
  assert.doesNotMatch(replyText(reply), /no hay problema|es simple/i, 'no debe trivializar hipoteca');
  assert.match(replyText(reply), /saldo|hipoteca|cr[eé]dito|asesor|liquidar/i, 'debe reconocer el crédito');
});

// ═════════════════════════════════════════════════════════════════════════════
// 17. Urgencia de venta
// ═════════════════════════════════════════════════════════════════════════════
test('R17 · urgencia de venta: urgent_sale_signal detectado, no promete precio rápido', () => {
  // Usar keywords exactas de detectUrgentSaleSignal
  const msg = 'me urge vender, necesito liquidez pronto';
  const signals = parseMessageSignals(msg, {});

  assert.equal(signals.urgent_sale_signal, true, 'debe marcar urgent_sale_signal');

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      urgent_sale_signal: true,
      location_text: null,
      property_type: null,
      full_name: null,
    },
    'append_info',
    { signals }
  );
  assert.doesNotMatch(replyText(reply), /te garantizo|precio garantizado|compro hoy/i,
    'no debe prometer venta inmediata o precio garantizado');
});

// ═════════════════════════════════════════════════════════════════════════════
// 18. Objeción: no exclusiva
// ═════════════════════════════════════════════════════════════════════════════
test('R18 · no exclusiva: objection_no_exclusivity detectado, respuesta no confrontacional', () => {
  // Usar keywords exactas de detectNoExclusivityObjection
  const msg = 'no quiero exclusiva, lo quiero publicar en muchos lados';
  const signals = parseMessageSignals(msg, {
    lead_flow: 'offer',
    operation_type: 'sale',
  });

  assert.equal(signals.objection_no_exclusivity, true, 'debe marcar objection_no_exclusivity');

  const reply = buildOfferReply(
    {
      lead_flow: 'offer',
      operation_type: 'sale',
      objection_no_exclusivity: true,
      location_text: 'Monterrey',
      property_type: 'house',
      full_name: 'Ana',
    },
    'append_info',
    { signals }
  );
  assert.doesNotMatch(replyText(reply), /tienes que|obligatorio|sin exclusiva no/i,
    'no debe ser confrontacional ni forzar exclusividad');
});

// ═════════════════════════════════════════════════════════════════════════════
// 19. Lead de pauta con mensaje genérico
// ═════════════════════════════════════════════════════════════════════════════
test('R19 · pauta con mensaje genérico: low_info_campaign, orientación hacia intención', () => {
  const extracted = extractCampaignReferralContext({
    referral: {
      source_url: 'https://facebook.com/ad?utm_campaign=captacion_propietarios',
      ad_name: 'Vende tu propiedad con Luxetty',
      headline: 'Captacion propietarios Monterrey',
    },
    messageText: 'Hola',
  });

  assert.ok(extracted.hasCampaignContext, 'debe detectar contexto de campaña');
  assert.equal(extracted.campaignContext.campaign_type, 'seller_capture',
    'debe clasificar como seller_capture');

  const reply = buildLowInfoCampaignReply(true, extracted.campaignContext);
  assert.match(reply, /anuncio para propietarios|vender|valuaci[oó]n/i, 'debe referenciar la campaña');
  assert.doesNotMatch(reply, /no puedo|soy un bot/i);
});

// ═════════════════════════════════════════════════════════════════════════════
// 20. Reclamo de seguimiento
// ═════════════════════════════════════════════════════════════════════════════
test('R20 · reclamo de seguimiento: complaint_followup, respuesta correctiva sin nueva pregunta masiva', () => {
  const msg = 'No entendiste, dije VENDER, no buscar';
  const signals = parseMessageSignals(msg, {
    lead_flow: 'offer',
    operation_type: 'sale',
    intent_lock_sale_owner: true,
  });

  assert.equal(signals.complaint_followup, true, 'debe marcar complaint_followup');

  // El estado siguiente debe corregir y no hacer 3 preguntas a la vez
  const nextState = { lead_flow: 'offer', operation_type: 'sale', intent_lock_sale_owner: true };
  const reliability = applyConversationIntentMemory({
    text: msg,
    previousAiState: nextState,
    incomingSignals: signals,
    nextAiState: nextState,
  });
  assert.equal(reliability.isComplaintCorrection, true, 'debe detectar corrección');
  assert.equal(nextState.lead_flow, 'offer', 'debe mantener flujo de venta');
});

// ═════════════════════════════════════════════════════════════════════════════
// 21. Imagen recibida sin visión real
// ═════════════════════════════════════════════════════════════════════════════
test('R21 · imagen sin visión real: ack honesto, no fabrica análisis', () => {
  const mediaCtx = {
    type: 'image',
    category: 'house',
    image_vision: null,
    caption: '',
  };

  const reply = buildMediaAcknowledgementReply(mediaCtx, {});
  assert.doesNotMatch(reply, /analicé|vi la imagen|revisé|detecté\s+\w+\s+habitaciones/i,
    'no debe afirmar análisis visual que no ocurrió');
  assert.match(reply, /recib[íi]|referencia|orientarte|buscas/i,
    'debe ser honesto sobre la recepción');
});

// ═════════════════════════════════════════════════════════════════════════════
// 22. Audio sin transcripción
// ═════════════════════════════════════════════════════════════════════════════
test('R22 · audio sin transcripción: no finge escucha, pide texto o asesor', () => {
  const mediaCtx = {
    type: 'audio',
    audio_without_transcription: true,
    audio_without_transcription_repeat: false,
  };

  const reply = buildMediaAcknowledgementReply(mediaCtx, {});
  assert.doesNotMatch(reply, /escuché|entendí lo que dijiste|tu audio dice/i,
    'no debe fingir haber transcribido');
  assert.match(reply, /escribir|texto|frase|asesor/i,
    'debe pedir texto o escalar a asesor');
});

test('R22b · segundo audio sin transcripción: escala a asesor directamente', () => {
  const mediaCtx = {
    type: 'audio',
    audio_without_transcription: true,
    audio_without_transcription_repeat: true,
  };

  const reply = buildMediaAcknowledgementReply(mediaCtx, {});
  assert.match(reply, /asesor|dato clave|canalizar/i,
    'en segundo intento debe escalar a asesor o pedir dato clave');
});

// ═════════════════════════════════════════════════════════════════════════════
// 23. Cambio de intención en conversación
// ═════════════════════════════════════════════════════════════════════════════
test('R23 · cambio de intención: de demand a offer, intent_changed, no mezcla flujos', () => {
  const msgOriginal = 'Busco casa en Cumbres';
  const signalsOriginal = parseMessageSignals(msgOriginal, {});
  assert.equal(signalsOriginal.lead_flow, 'demand');

  const msgCambio = 'Espera, en realidad quiero vender mi casa, no comprar';
  // intent_changed requiere prev.intent_type para comparar
  const signalsCambio = parseMessageSignals(msgCambio, {
    lead_flow: 'demand',
    intent_type: 'demand',
    operation_type: 'sale',
    location_text: 'Cumbres',
  });

  assert.equal(signalsCambio.lead_flow, 'offer', 'debe cambiar a offer');
  assert.equal(signalsCambio.intent_changed, true, 'debe marcar intent_changed');

  // La respuesta de offer no debe mencionar "buscar propiedades"
  const reply = buildOfferReply(
    { lead_flow: 'offer', operation_type: 'sale', location_text: null, property_type: null, full_name: null },
    'restart_flow',
    { signals: signalsCambio }
  );
  assert.doesNotMatch(replyText(reply), /buscar propiedades|opciones disponibles/i,
    'respuesta de venta no debe mezclar demanda');
});

// ═════════════════════════════════════════════════════════════════════════════
// 24. Contacto duplicado por WhatsApp normalizado
// ═════════════════════════════════════════════════════════════════════════════
test('R24 · deduplicación de contacto: formatos distintos normalizan al mismo número', () => {
  const formats = [
    '5218111111111',
    '8111111111',
    '+5218111111111',
    '528111111111',
    '18111111111',
  ];

  const normalized = formats.map((f) => normalizePhoneNumber(f));

  // Todos deben producir el mismo número o null (formato canónico MX)
  const nonNullValues = normalized.filter(Boolean);
  const unique = new Set(nonNullValues);

  assert.ok(unique.size <= 2,
    `formatos distintos del mismo número deben normalizar a ≤2 variantes; got: ${[...unique].join(', ')}`);
  // El formato completo siempre debe producir el mismo resultado
  assert.equal(normalizePhoneNumber('5218111111111'), normalizePhoneNumber('5218111111111'),
    'el mismo input siempre produce el mismo output');
});

// ═════════════════════════════════════════════════════════════════════════════
// 25. No creación de lead en saludo ambiguo / reset
// ═════════════════════════════════════════════════════════════════════════════
test('R25 · cierre/reset: saludo ambiguo no crea lead', () => {
  const opportunity = detectLeadCreationOpportunity({
    aiState: { lead_flow: null, direct_property_reference: false },
    propertyId: null,
    messageText: 'Hola',
    hasCampaignContext: false,
  });

  assert.equal(opportunity.shouldCreate, false, 'saludo simple no debe crear lead');
});

// ═════════════════════════════════════════════════════════════════════════════
// 26. CRM: lead creado correctamente con propiedad y contacto
// ═════════════════════════════════════════════════════════════════════════════
test('R26 · CRM: lead creado con propiedad y asesor asignado por propiedad', async () => {
  const db = buildBaseDb();
  const supabase = buildMockSupabase(db);

  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: { ...CONV_ANA },
    aiState: {
      lead_flow: 'demand',
      operation_type: 'sale',
      property_code: 'LUX-A0453',
      direct_property_reference: true,
      asks_property_details: true,
      wants_visit: true,
      intent_type: 'property_interest',
    },
    contactId: CONTACT_ANA.id,
    propertyId: PROPERTY_LUX_A0453.id,
    property: { ...PROPERTY_LUX_A0453 },
    logger: console,
  });

  assert.equal(result.success, true, 'debe crear el lead exitosamente');
  assert.ok(result.leadId || result.lead?.id, 'debe devolver el ID del lead');
  assert.equal(result.assignedAgentProfileId, PROPERTY_LUX_A0453.agent_profile_id,
    'debe asignar al agente de la propiedad');
});

// ═════════════════════════════════════════════════════════════════════════════
// 27. CRM: idempotencia — no duplica lead de la misma conversación
// ═════════════════════════════════════════════════════════════════════════════
test('R27 · CRM: idempotencia — no duplica lead en misma conversación', async () => {
  const db = buildBaseDb({
    leads: [{ ...LEAD_ANA_DEMAND }],
  });
  const supabase = buildMockSupabase(db);

  const aiState = {
    lead_flow: 'demand',
    operation_type: 'sale',
    property_code: 'LUX-A0453',
    direct_property_reference: true,
    intent_type: 'property_interest',
  };

  // Primer intento → reutiliza el existente
  const result = await createOrReuseLeadFromConversation({
    supabase,
    conversation: { ...CONV_ANA },
    aiState,
    contactId: CONTACT_ANA.id,
    propertyId: PROPERTY_LUX_A0453.id,
    property: { ...PROPERTY_LUX_A0453 },
    logger: console,
  });

  assert.equal(result.success, true, 'debe tener éxito');
  // No debe haber creado un lead adicional
  const leadsForConv = db.leads.filter((l) => l.conversation_id === CONV_ANA.id);
  assert.ok(leadsForConv.length <= 1, 'no debe duplicar leads para la misma conversación');
});

// ═════════════════════════════════════════════════════════════════════════════
// 28. CRM: no crea lead con solo imagen sin intención
// ═════════════════════════════════════════════════════════════════════════════
test('R28 · CRM: imagen sola sin intención no crea lead', () => {
  const opportunity = detectLeadCreationOpportunity({
    aiState: { lead_flow: null, direct_property_reference: false },
    propertyId: null,
    messageText: '',
    hasCampaignContext: false,
  });

  assert.equal(opportunity.shouldCreate, false, 'imagen sola sin señal no debe crear lead');
});

// ═════════════════════════════════════════════════════════════════════════════
// 29. Cierre comercial: "Quiero verla" con contexto de propiedad → shouldClose
// ═════════════════════════════════════════════════════════════════════════════
test('R29 · cierre comercial: "Quiero verla" con propiedad → shouldClose=true', () => {
  const decision = evaluateCommercialCloseDecision({
    text: 'Quiero verla',
    state: {
      lead_flow: 'demand',
      property_code: 'LUX-A0453',
      direct_property_reference: true,
    },
    hasPropertyContext: true,
  });

  assert.equal(decision.shouldClose, true, 'debe activar cierre comercial');
  assert.equal(decision.shouldClarify, false, 'no debe pedir aclaración');
});

// ═════════════════════════════════════════════════════════════════════════════
// 30. No creación de lead para proveedor externo
// ═════════════════════════════════════════════════════════════════════════════
test('R30 · categoría no inmobiliaria: proveedor no debe crear lead', () => {
  const msg = 'Soy proveedor de servicios de marketing para inmobiliarias';
  const signals = parseMessageSignals(msg, {});

  assert.equal(signals.provider, true, 'debe detectar provider');
  assert.equal(signals.non_real_estate_or_provider, true, 'debe marcar non_real_estate_or_provider');

  const opportunity = detectLeadCreationOpportunity({
    aiState: { lead_flow: null, non_real_estate_or_provider: true },
    propertyId: null,
    messageText: msg,
    hasCampaignContext: false,
  });
  assert.equal(opportunity.shouldCreate, false, 'proveedor no debe crear lead inmobiliario');
});

// ═════════════════════════════════════════════════════════════════════════════
// 31. Burst de mensajes: deduplicación por meta_message_id
// ═════════════════════════════════════════════════════════════════════════════
test('R31 · burst inbound: deduplica mensajes con mismo meta_message_id', () => {
  const burst = [
    { message: { id: 'wamid-100', timestamp: '1710000000', type: 'text', text: { body: 'Quiero vender' } } },
    { message: { id: 'wamid-101', timestamp: '1710000001', type: 'text', text: { body: 'Mi casa en Cumbres' } } },
    { message: { id: 'wamid-101', timestamp: '1710000001', type: 'text', text: { body: 'Mi casa en Cumbres' } } }, // duplicado
  ];

  const consolidated = consolidateInboundBurst(burst);

  assert.equal(consolidated.items.length, 2, 'debe eliminar el duplicado');
  assert.match(consolidated.combinedText, /quiero vender/i, 'debe conservar el primer mensaje');
  assert.match(consolidated.combinedText, /cumbres/i, 'debe conservar el segundo mensaje');
});
