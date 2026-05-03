const {
  formatMoney,
  formatPropertyTypeLabel,
  formatPropertyShort,
  formatPropertyList,
} = require('../utils/formatting');
const { safeJsonStringify } = require('../utils/helpers');
const { SYSTEM_PROMPT } = require('../config/prompts');
const { openai } = require('../services/openaiService');
const { qualifiesDemandValue } = require('./searchRules');

function buildAiSummary(state, properties = []) {
  const parts = [];

  if (state.full_name) parts.push(`Nombre: ${state.full_name}.`);

  if (state.lead_flow === 'demand') {
    parts.push(`Lead buscando ${state.operation_type === 'rent' ? 'renta' : 'compra'}.`);
  } else if (state.lead_flow === 'offer') {
    parts.push(`Lead quiere ${state.operation_type === 'rent' ? 'poner en renta' : 'vender'} su propiedad.`);
  }

  if (state.property_code) {
    parts.push(`Referencia directa a propiedad por ID oficial: ${state.property_code}.`);
  }

  if (state.property_type) {
    parts.push(`Tipo: ${formatPropertyTypeLabel(state.property_type)}.`);
  }

  if (state.location_text) {
    parts.push(`Ubicación: ${state.location_text}.`);
  } else if (state.location_any) {
    parts.push('Ubicación abierta.');
  }

  if (state.budget_max) {
    parts.push(`Monto: ${formatMoney(state.budget_max, state.budget_currency || 'MXN')}.`);
  }

  if (state.owner_relation) {
    parts.push(`Relación con propiedad: ${state.owner_relation}.`);
  }

  if (state.contact_preference) {
    parts.push(`Canal preferido: ${state.contact_preference}.`);
  }

  if (state.timeline_text) {
    parts.push(`Tiempo: ${state.timeline_text}.`);
  }

  if (state.contact_number_confirmed === true) {
    parts.push('Número confirmado.');
  }

  if (state.wants_visit) parts.push('Quiere agendar visita.');
  if (state.shows_high_interest) parts.push('Muestra alto interés.');
  if (state.asks_property_details) parts.push('Está pidiendo más detalles de la propiedad.');
  if (state.direct_property_reference) parts.push('Entró por referencia directa de propiedad.');

  if (properties.length > 0) {
    parts.push(`Resultados actuales: ${properties.length}.`);
  } else if (state.last_search_result_count === 0 && state.lead_flow === 'demand') {
    parts.push('Sin resultados exactos en última búsqueda.');
  }

  return parts.join(' ').trim() || null;
}

function getChangeAcknowledgement(changeType, state) {
  if (changeType === 'restart_flow') {
    if (state.lead_flow === 'offer' && state.operation_type === 'sale') {
      return 'Entendido, avanzamos con la venta.';
    }
    if (state.lead_flow === 'offer' && state.operation_type === 'rent') {
      return 'Entendido, avanzamos con ponerla en renta.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'sale') {
      return 'Entendido, avanzamos con la búsqueda de compra.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'rent') {
      return 'Entendido, avanzamos con la búsqueda de renta.';
    }
  }

  if (changeType === 'radical_change') {
    if (state.location_any) return 'Entendido, amplío la búsqueda.';
    if (state.location_text) return `Entendido, actualizo la búsqueda a ${state.location_text}.`;
    return 'Entendido, actualizo la búsqueda.';
  }

  if (changeType === 'minor_update') return 'Con gusto, lo actualizo.';
  return 'Entendido.';
}

function buildDemandLowValueReply(state) {
  if (state.operation_type === 'sale') {
    return 'Por el momento nos especializamos en propiedades en compra desde $3,000,000 MXN. Si deseas, podemos ajustar la búsqueda o un asesor de Luxetty puede orientarte sobre alternativas.';
  }

  return 'Por el momento nos especializamos en propiedades en renta desde $10,000 MXN. Si deseas, podemos ajustar el rango o un asesor de Luxetty puede orientarte.';
}

function buildOfferRejectedReply(state) {
  if (state.geo_qualified === false) {
    return 'Por el momento nos especializamos en zonas de alto valor en Monterrey y área metropolitana. Si deseas, puedo canalizar tu caso con un asesor de Luxetty para más orientación.';
  }

  if (state.value_qualified === false) {
    return 'Por el momento nos especializamos en propiedades de mayor valor. Con gusto puedo canalizarte con un asesor de Luxetty si deseas más información.';
  }

  return 'Para darte una respuesta precisa, puedo canalizar tu caso con un asesor de Luxetty que lo revise contigo.';
}

function buildFinalHandoffReply(state) {
  const name = state.full_name ? `, ${state.full_name}` : '';
  const channel =
    state.contact_preference === 'call'
      ? 'por llamada'
      : 'por WhatsApp';

  if (state.lead_flow === 'offer') {
    return `Perfecto${name}. Ya dejé tu caso listo y un asesor de Luxetty te contactará ${channel} para revisarlo contigo.`;
  }

  if (state.wants_visit) {
    return `Perfecto${name}. Ya dejé tu solicitud para coordinar la visita y un asesor te contactará ${channel} para avanzar contigo.`;
  }

  if (state.direct_property_reference && state.property_code) {
    return `Perfecto${name}. Ya dejé registrada tu solicitud sobre la propiedad con ID ${state.property_code} y un asesor de Luxetty te contactará ${channel} para ayudarte a avanzar.`;
  }

  return `Perfecto${name}. Ya dejé tu búsqueda lista y un asesor de Luxetty te contactará ${channel} para ayudarte a avanzar con las mejores opciones.`;
}

function getDemandMatchQuality(state, properties = []) {
  if (state?.result_quality) return state.result_quality;

  if (!Array.isArray(properties) || properties.length === 0) {
    return 'none';
  }

  const topScore = Number(properties[0]?.match_score || 0);

  if (topScore >= 80) return 'strong';
  if (topScore >= 55) return 'medium';
  if (topScore >= 35) return 'weak';
  return 'very_weak';
}

function hasCommercialIntent(state) {
  return (
    !!state.wants_visit ||
    !!state.shows_high_interest ||
    !!state.asks_property_details ||
    !!state.direct_property_reference
  );
}

function getDemandActionClosing(state, matchQuality) {
  if (state.direct_property_reference && state.property_code) {
    if (state.wants_visit) {
      return '¿Deseas coordinar una visita o que un asesor de Luxetty te contacte?';
    }

    if (state.asks_property_details) {
      return `¿Deseas que un asesor de Luxetty te dé más detalle sobre la propiedad con ID ${state.property_code}?`;
    }

    return '¿Deseas que un asesor de Luxetty la revise contigo y te oriente para avanzar?';
  }

  if (state.wants_visit) {
    return '¿Deseas coordinar una visita o que un asesor de Luxetty te contacte?';
  }

  if (state.asks_property_details) {
    return '¿Deseas que un asesor de Luxetty te dé más detalle sobre esta opción?';
  }

  if (state.shows_high_interest) {
    return '¿Deseas que un asesor de Luxetty la revise contigo y te oriente para avanzar?';
  }

  if (matchQuality === 'strong') {
    return 'Es una muy buena opción. ¿Deseas coordinar una visita o que un asesor de Luxetty te contacte?';
  }

  if (matchQuality === 'medium') {
    return 'Puede ser una buena opción. ¿Deseas que un asesor de Luxetty la revise contigo?';
  }

  return '¿Deseas ajustar la búsqueda o que un asesor de Luxetty te oriente?';
}

function getPropertyVisibleCode(property = {}, state = {}) {
  return (
    property.listing_id ||
    property.public_code ||
    state.property_code ||
    state.direct_property_code ||
    'esta propiedad'
  );
}

function getPropertyLocationLabel(property = {}) {
  return (
    property.neighborhood ||
    property.zone ||
    property.municipality ||
    property.city ||
    null
  );
}

function getPropertySlugUrl(property = {}) {
  const slug = typeof property.slug === 'string' ? property.slug.trim() : '';
  if (!slug || /\s/.test(slug)) return null;

  const cleanSlug = slug
    .replace(/^https?:\/\/(?:www\.)?luxetty\.com\/propiedad\//i, '')
    .replace(/^\/?propiedad\//i, '')
    .replace(/^\/+|\/+$/g, '');

  if (!cleanSlug || /\s/.test(cleanSlug)) return null;
  return `https://luxetty.com/propiedad/${cleanSlug}`;
}

function hasValidPropertyPrice(property = {}) {
  const price = Number(property.price);
  return Number.isFinite(price) && price > 0;
}

function buildPropertyAdvisorCta(state = {}, code = null) {
  if (state.full_name) {
    return `Si me autorizas, un asesor de Luxetty puede contactarte para apoyarte con detalles confirmados y visita de ${code || 'la propiedad'}. ¿Deseas que te contacte?`;
  }

  return 'Para que un asesor de Luxetty pueda apoyarte con detalles confirmados y visita, ¿me compartes tu nombre?';
}

function buildPropertyInterestReply(property, state = {}) {
  const code = getPropertyVisibleCode(property, state);
  const location = getPropertyLocationLabel(property);
  const url = getPropertySlugUrl(property);
  const locationText = location ? ` en ${location}` : '';

  if (!url) {
    return [
      `Con gusto. Identifiqué la propiedad ${code}${locationText}.`,
      `Para compartirte información confirmada, voy a canalizar tu caso con un asesor de Luxetty. ${buildPropertyAdvisorCta(state, code)}`,
    ];
  }

  return [
    `Con gusto. Te comparto la liga de la propiedad ${code}${locationText}.`,
    url,
    buildPropertyAdvisorCta(state, code),
  ];
}

function buildPropertyPriceReply(property, state = {}) {
  const code = getPropertyVisibleCode(property, state);

  if (!hasValidPropertyPrice(property)) {
    return `De momento no tengo un precio público confirmado para la propiedad ${code}. Te puedo compartir los detalles disponibles o revisarlo con un asesor.

¿Quieres que lo revisemos contigo?`;
  }

  return `La propiedad ${code} está en ${formatMoney(property.price, property.currency_code || 'MXN')}.

¿Quieres verla esta semana?`;
}

function buildDirectPropertyReply(state, changeType, properties = []) {
  const property = Array.isArray(properties) && properties.length > 0 ? properties[0] : null;

  if (!property) {
    return `No encontré una propiedad activa con el ID ${state.property_code}. Si deseas, puedo ampliar la búsqueda por zona o canalizar tu caso con un asesor de Luxetty para ayudarte.`;
  }

  const template = getPropertySlugUrl(property)
    ? 'property_interest_microcommitment'
    : 'property_interest_missing_slug_human_attention';

  console.log('PROPERTY INTEREST REPLY TEMPLATE:', {
    property_id: property?.id || null,
    property_code: getPropertyVisibleCode(property, state),
    slug_present: !!getPropertySlugUrl(property),
    template,
  });

  return buildPropertyInterestReply(property, state);
}

function buildDemandReply(state, changeType, properties, attemptUsed) {
  if (state.direct_property_reference && state.property_code) {
    return buildDirectPropertyReply(state, changeType, properties);
  }

  const ack = getChangeAcknowledgement(changeType, state);
  const hasResults = Array.isArray(properties) && properties.length > 0;
  const matchQuality = getDemandMatchQuality(state, properties);
  const commercialIntent = hasCommercialIntent(state);

  if (!state.operation_type) {
    return 'Para orientarte mejor, ¿buscas comprar o rentar una propiedad?';
  }

  if (!state.location_text && !state.location_any) {
    return `${ack}\n¿En qué zona te interesa buscar?`;
  }

  if (state.budget_max == null) {
    return `${ack}\n¿Cuál es tu presupuesto aproximado?`;
  }

  if (!state.budget_currency) {
    return `${ack}\n¿Tu presupuesto es en MXN o USD?`;
  }

  if (!qualifiesDemandValue(state)) {
    return buildDemandLowValueReply(state);
  }

  if (matchQuality === 'very_weak') {
    return `${ack}\nNo encontré opciones que coincidan exactamente con lo que buscas. ¿Deseas ajustar los criterios o que un asesor de Luxetty te oriente?`;
  }

  if (hasResults) {
    if (properties.length === 1) {
      return `${ack}\nTe comparto una opción que vale la pena revisar:\n\n${formatPropertyShort(properties[0])}\n\n${getDemandActionClosing(state, matchQuality)}`;
    }

    return `${ack}\nEstas son las opciones más relevantes que encontré:\n\n${formatPropertyList(properties)}\n\n${getDemandActionClosing(state, matchQuality)}`;
  }

  const noExact = `${ack}\nNo encontré una coincidencia exacta en este momento.`;

  if (commercialIntent) {
    return `${noExact}\n¿Deseas que un asesor de Luxetty revise opciones contigo y te oriente para avanzar?`;
  }

  // 🔒 Anti-loop: si no hay cambio real y no hay propiedades
  if (
    !changeType &&
    (!properties || properties.length === 0)
  ) {
    return '¿Me compartes la zona, presupuesto aproximado y si buscas comprar o rentar?';
  }

  return `${noExact}\n¿Deseas ajustar la búsqueda o que un asesor de Luxetty te oriente hacia opciones más alineadas?`;
}

function buildOfferReply(state, changeType) {
  const ack = getChangeAcknowledgement(changeType, state);

  if (!state.property_type) {
    return `${ack}\n¿Qué tipo de propiedad quieres vender o poner en renta?`;
  }

  if (!state.location_text) {
    return `${ack}\n¿En qué zona está la propiedad?`;
  }

  if (state.geo_qualified === false || state.value_qualified === false) {
    return buildOfferRejectedReply(state);
  }

  if (state.budget_max == null) {
    return `${ack}\n¿En cuánto te gustaría venderla o rentarla aproximadamente?`;
  }

  if (!state.budget_currency) {
    return `${ack}\n¿Ese monto es en MXN o USD?`;
  }

  if (state.owner_relation == null) {
    return `${ack}\n¿La propiedad es tuya o estás apoyando a alguien?`;
  }

  if (!state.full_name) {
    return `${ack}\n¿Me compartes tu nombre completo?`;
  }

  if (!state.contact_preference) {
    return `${ack}\n¿Prefieres que te contacten por WhatsApp o por llamada?`;
  }

  if (state.contact_number_confirmed == null) {
    return `${ack}\n¿Este es el mejor número para contactarte?`;
  }

  return 'Todo listo. Un asesor de Luxetty te contactará para revisar los detalles contigo.';
}

async function buildFallbackOpenAIReply(text, state, changeType) {
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-5-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'system',
        content: `Estado actual:
${safeJsonStringify(state)}

Tipo de cambio detectado: ${changeType}

IMPORTANTE:
- No compartas propiedades específicas.
- No inventes resultados.
- Máximo una pregunta.
- Mantén tono premium, natural y comercial.
- Si detectas interés, orienta a visita o asesor.
- Si existe referencia directa a propiedad, responde como seguimiento de esa propiedad.
- Habla del ID oficial si ya existe uno detectado.
- No suenes como bot.
`,
      },
      { role: 'user', content: text },
    ],
  });

  return (
    response.choices?.[0]?.message?.content?.trim() ||
    '¿En qué puedo orientarte? ¿Buscas comprar, rentar, vender o poner en renta una propiedad?'
  );
}

module.exports = {
  buildAiSummary,
  getChangeAcknowledgement,
  buildDemandLowValueReply,
  buildOfferRejectedReply,
  buildFinalHandoffReply,
  buildPropertyInterestReply,
  buildPropertyPriceReply,
  buildDirectPropertyReply,
  buildDemandReply,
  buildOfferReply,
  buildFallbackOpenAIReply,
};
