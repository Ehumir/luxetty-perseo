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

  if (state.property_type) parts.push(`Tipo: ${formatPropertyTypeLabel(state.property_type)}.`);
  if (state.location_text) parts.push(`Ubicación: ${state.location_text}.`);
  if (state.budget_max) parts.push(`Monto: ${formatMoney(state.budget_max, state.budget_currency || 'MXN')}.`);
  if (state.owner_relation) parts.push(`Relación con propiedad: ${state.owner_relation}.`);
  if (state.contact_preference) parts.push(`Canal preferido: ${state.contact_preference}.`);
  if (state.timeline_text) parts.push(`Tiempo: ${state.timeline_text}.`);

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
    return 'Por el momento estamos enfocados en opciones de compra desde $3,000,000 MXN. Si quieres, te ayudo a ajustar la búsqueda o te paso con un asesor.';
  }

  return 'Por el momento estamos enfocados en opciones de renta desde $10,000 MXN. Si quieres, te ayudo a ajustar la búsqueda.';
}

function buildOfferRejectedReply(state) {
  if (state.geo_qualified === false) {
    return 'Por el momento estamos enfocados en Monterrey, Cumbres, García, San Pedro, Carretera Nacional y zonas residenciales de alto valor en Guadalupe, San Nicolás, Apodaca y Santa Catarina.';
  }

  if (state.value_qualified === false) {
    return 'Por el momento estamos enfocados en propiedades de mayor valor en ciertas zonas, pero con gusto puedo orientarte brevemente si lo necesitas.';
  }

  return 'Por el momento necesito revisar un poco más el caso para orientarte correctamente.';
}

function buildFinalHandoffReply(state) {
  const name = state.full_name ? `, ${state.full_name}` : '';
  const channel =
    state.contact_preference === 'call'
      ? 'por llamada'
      : 'por WhatsApp';

  if (state.lead_flow === 'offer') {
    return `Perfecto${name}. Ya dejé tu caso registrado y un asesor de Luxetty te contactará ${channel} para revisar la propiedad contigo.`;
  }

  return `Perfecto${name}. Ya dejé tu búsqueda registrada y un asesor de Luxetty te contactará ${channel} para ayudarte con opciones alineadas.`;
}

function getDemandMatchQuality(properties = []) {
  if (!Array.isArray(properties) || properties.length === 0) {
    return 'none';
  }

  const topScore = Number(properties[0]?.match_score || 0);

  if (topScore >= 80) return 'strong';
  if (topScore >= 55) return 'medium';
  return 'weak';
}

function buildDemandReply(state, changeType, properties, attemptUsed) {
  const ack = getChangeAcknowledgement(changeType, state);
  const hasResults = Array.isArray(properties) && properties.length > 0;
  const matchQuality = getDemandMatchQuality(properties);

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

  if (hasResults) {
    if (properties.length === 1) {
      if (matchQuality === 'strong') {
        return `${ack}\nEncontré una opción muy alineada con lo que buscas:\n\n${formatPropertyShort(properties[0])}\n\nSi quieres, te comparto otra opción o afinamos la búsqueda.`;
      }

      return `${ack}\nEncontré una opción cercana a lo que buscas:\n\n${formatPropertyShort(properties[0])}\n\nSi quieres, ajusto un poco más la búsqueda o te comparto alternativas.`;
    }

    if (matchQuality === 'strong') {
      return `${ack}\nEstas son las opciones más alineadas que encontré para ti:\n\n${formatPropertyList(properties)}\n\nSi quieres, puedo afinar más la búsqueda o ayudarte a pasar con un asesor.`;
    }

    if (matchQuality === 'medium') {
      return `${ack}\nEncontré opciones cercanas a lo que buscas:\n\n${formatPropertyList(properties)}\n\nSi quieres, ajusto un poco más la búsqueda para acercarnos todavía más.`;
    }

    return `${ack}\nEncontré algunas alternativas que podrían servirte:\n\n${formatPropertyList(properties)}\n\nSi quieres, afino la búsqueda para mostrarte opciones más alineadas.`;
  }

  const noExact = `${ack}\nNo encontré una coincidencia exacta en este momento.`;

  if (attemptUsed === 'expanded_budget') {
    return `${noExact}\nYa amplié criterios para buscar alternativas, pero no vi algo realmente alineado. Puedo ampliar zona o presupuesto, o dejarte con un asesor. ¿Qué prefieres?`;
  }

  return `${noExact}\nPuedo ajustar la búsqueda o dejarte con un asesor para ayudarte mejor. ¿Qué prefieres?`;
}

function buildOfferReply(state, changeType) {
  const ack = getChangeAcknowledgement(changeType, state);

  if (!state.property_type) {
    return `${ack}\n¿Qué tipo de propiedad quieres vender o poner en renta?`;
  }

  if (!state.location_text) {
    return `${ack}\n¿En qué zona, colonia o municipio está la propiedad?`;
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

  return 'Perfecto, ya tengo todo lo necesario. Te voy a conectar con un asesor para continuar.';
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
- Mantén tono premium, natural y amable.
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
  buildDemandReply,
  buildOfferReply,
  buildFallbackOpenAIReply,
};