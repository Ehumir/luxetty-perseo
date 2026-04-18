const { formatMoney, formatPropertyTypeLabel, formatPropertyShort, formatPropertyList } = require('../utils/formatting');
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

  if (state.property_code) parts.push(`Referencia directa a propiedad: ${state.property_code}.`);
  if (state.property_type) parts.push(`Tipo: ${formatPropertyTypeLabel(state.property_type)}.`);
  if (state.location_text) parts.push(`Ubicación: ${state.location_text}.`);
  if (state.budget_max) parts.push(`Monto: ${formatMoney(state.budget_max, state.budget_currency || 'MXN')}.`);
  if (state.owner_relation) parts.push(`Relación con propiedad: ${state.owner_relation}.`);
  if (state.contact_preference) parts.push(`Canal preferido: ${state.contact_preference}.`);
  if (state.timeline_text) parts.push(`Tiempo: ${state.timeline_text}.`);

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
      return 'Perfecto, ahora te apoyo con la venta.';
    }
    if (state.lead_flow === 'offer' && state.operation_type === 'rent') {
      return 'Perfecto, ahora te apoyo con ponerla en renta.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'sale') {
      return 'Perfecto, ahora te apoyo con la búsqueda de compra.';
    }
    if (state.lead_flow === 'demand' && state.operation_type === 'rent') {
      return 'Perfecto, ahora te apoyo con la búsqueda de renta.';
    }
  }

  if (changeType === 'radical_change') {
    if (state.location_any) return 'Perfecto, amplio la búsqueda.';
    if (state.location_text) return `Perfecto, actualizo la búsqueda a ${state.location_text}.`;
    return 'Perfecto, actualizo la búsqueda.';
  }

  if (changeType === 'minor_update') return 'Perfecto, lo actualizo.';
  return 'Perfecto.';
}

function buildDemandLowValueReply(state) {
  if (state.operation_type === 'sale') {
    return 'Por el momento estamos enfocados en opciones de compra desde $3,000,000 MXN. Si quieres, te ayudo a ajustar la búsqueda o te puedo conectar con un asesor para ver alternativas.';
  }

  return 'Por el momento estamos enfocados en opciones de renta desde $10,000 MXN. Si quieres, te ayudo a ajustar la búsqueda o vemos alternativas contigo.';
}

function buildOfferRejectedReply(state) {
  if (state.geo_qualified === false) {
    return 'Por el momento estamos enfocados en ciertas zonas de alto valor en Monterrey y alrededores. Si quieres, te puedo orientar brevemente o revisar otras opciones contigo.';
  }

  if (state.value_qualified === false) {
    return 'Por el momento estamos enfocados en propiedades de mayor valor en ciertas zonas, pero con gusto puedo orientarte brevemente si lo necesitas.';
  }

  return 'Déjame revisar mejor tu caso para orientarte correctamente.';
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
    return `Perfecto${name}. Ya dejé registrada tu solicitud sobre la propiedad ${state.property_code} y un asesor de Luxetty te contactará ${channel} para ayudarte a avanzar.`;
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
      return `Si esta propiedad te hace sentido, te ayudo a coordinar la visita o avanzamos con un asesor.`;
    }

    if (state.asks_property_details) {
      return `Si quieres, te conecto con un asesor para darte más detalle sobre la propiedad ${state.property_code} y ayudarte a avanzar.`;
    }

    return `Si esta propiedad te interesa, te conecto con un asesor para revisarla contigo y ayudarte a avanzar.`;
  }

  if (state.wants_visit) {
    return 'Si esta propiedad te hace sentido, te ayudo a coordinar la visita o avanzamos con un asesor.';
  }

  if (state.asks_property_details) {
    return 'Si quieres, te conecto con un asesor para darte más detalle y ayudarte a avanzar con esta opción.';
  }

  if (state.shows_high_interest) {
    return 'Si esta opción te hace sentido, te conecto con un asesor para revisarla contigo y ayudarte a avanzar.';
  }

  if (matchQuality === 'strong') {
    return 'Esta es una muy buena opción. Si te hace sentido, te ayudo a coordinar visita o a avanzar con un asesor.';
  }

  if (matchQuality === 'medium') {
    return 'Puede ser una buena opción para ti. Si quieres, la revisamos contigo y vemos si vale la pena avanzar.';
  }

  return 'Si quieres, ajustamos la búsqueda o vemos contigo opciones más alineadas.';
}

function buildDirectPropertyReply(state, changeType, properties = []) {
  const ack = getChangeAcknowledgement(changeType, state);
  const property = Array.isArray(properties) && properties.length > 0 ? properties[0] : null;

  if (!property) {
    return `No encontré una propiedad activa con el ID ${state.property_code}. Si quieres, dime qué tipo de propiedad buscas y te ayudo a encontrar opciones.`;
  }

  const codeLabel = state.property_code ? ` ${state.property_code}` : '';
  const baseIntro =
    changeType === 'radical_change' || changeType === 'restart_flow'
      ? `${ack}\nYa ubiqué la propiedad${codeLabel}.`
      : `Ya ubiqué la propiedad${codeLabel}.`;

  if (state.wants_visit) {
    return `${baseIntro}\n\n${formatPropertyShort(property)}\n\nSi te hace sentido, te ayudo a coordinar la visita o te conecto con un asesor para avanzar.`;
  }

  if (state.asks_property_details) {
    return `${baseIntro}\n\n${formatPropertyShort(property)}\n\nSi quieres, te conecto con un asesor para darte más detalle y revisar esta opción contigo.`;
  }

  if (state.shows_high_interest) {
    return `${baseIntro}\n\n${formatPropertyShort(property)}\n\nSe ve como una opción que vale la pena revisar. Si quieres, te conecto con un asesor para ayudarte a avanzar con esta propiedad.`;
  }

  return `${baseIntro}\n\n${formatPropertyShort(property)}\n\nSi quieres, te doy más detalle o te ayudo a coordinar una visita.`;
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
    return 'Con gusto te ayudo. ¿Buscas comprar o rentar?';
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
    return `${ack}\nNo veo algo realmente alineado con lo que buscas. Si quieres, ajustamos la búsqueda o lo revisamos contigo con un asesor.`;
  }

  if (hasResults) {
    if (properties.length === 1) {
      return `${ack}\nTe comparto una opción que vale la pena revisar:\n\n${formatPropertyShort(properties[0])}\n\n${getDemandActionClosing(state, matchQuality)}`;
    }

    return `${ack}\nEstas son las opciones más relevantes que encontré:\n\n${formatPropertyList(properties)}\n\n${getDemandActionClosing(state, matchQuality)}`;
  }

  const noExact = `${ack}\nNo encontré una coincidencia exacta en este momento.`;

  if (commercialIntent) {
    return `${noExact}\nSi quieres, te conecto con un asesor para revisar opciones contigo y avanzar.`;
  }

  return `${noExact}\nSi quieres, ajustamos la búsqueda o lo revisamos contigo para encontrar algo más alineado.`;
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

  return 'Perfecto, ya tengo todo listo. Te conecto con un asesor para continuar.';
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
- No suenes como bot.
`,
      },
      { role: 'user', content: text },
    ],
  });

  return (
    response.choices?.[0]?.message?.content?.trim() ||
    'Con gusto te ayudo. ¿Buscas comprar, rentar, vender o poner en renta una propiedad?'
  );
}

module.exports = {
  buildAiSummary,
  getChangeAcknowledgement,
  buildDemandLowValueReply,
  buildOfferRejectedReply,
  buildFinalHandoffReply,
  buildDirectPropertyReply,
  buildDemandReply,
  buildOfferReply,
  buildFallbackOpenAIReply,
};