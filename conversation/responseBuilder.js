const { formatMoney, formatPropertyTypeLabel, formatPropertyShort, formatPropertyList } = require('../utils/formatting');
const { safeJsonStringify, sanitizeReply } = require('../utils/helpers');
const { normalizeText } = require('../utils/text');
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

  if (properties.length > 0) parts.push(`Resultados actuales: ${properties.length}.`);
  else if (state.last_search_result_count === 0 && state.lead_flow === 'demand') parts.push('Sin resultados exactos en última búsqueda.');

  return parts.join(' ').trim() || null;
}

function getChangeAcknowledgement(changeType, state) {
  if (changeType === 'restart_flow') {
    if (state.lead_flow === 'offer' && state.operation_type === 'sale') return 'Perfecto, ahora te apoyo con la venta.';
    if (state.lead_flow === 'offer' && state.operation_type === 'rent') return 'Perfecto, ahora te apoyo con ponerla en renta.';
    if (state.lead_flow === 'demand' && state.operation_type === 'sale') return 'Perfecto, ahora te apoyo con la búsqueda de compra.';
    if (state.lead_flow === 'demand' && state.operation_type === 'rent') return 'Perfecto, ahora te apoyo con la búsqueda de renta.';
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
    return 'Por el momento estamos enfocados en opciones de compra desde $3,000,000 MXN. Si quieres, te oriento brevemente o te ayudo a ajustar la búsqueda.';
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

function buildDemandReply(state, changeType, properties, attemptUsed) {
  const ack = getChangeAcknowledgement(changeType, state);

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

  if (properties.length > 0) {
    if (properties.length === 1) {
      return `${ack}
Tengo una opción real para ti:

${formatPropertyShort(properties[0])}

¿Quieres que te comparta otra opción o prefieres que te contacte un asesor?`;
    }

    return `${ack}
Encontré opciones reales para ti:

${formatPropertyList(properties)}

¿Prefieres que te contacte un asesor o quieres que afine la búsqueda?`;
  }

  const noExact = `${ack}
No tengo una coincidencia exacta en este momento.`;

  if (attemptUsed === 'expanded_budget') {
    return `${noExact}
Puedo ampliar zona o presupuesto, o dejarte con un asesor para alternativas reales. ¿Qué prefieres?`;
  }

  return `${noExact}
¿Quieres que amplíe la búsqueda o prefieres que te contacte un asesor?`;
}

function buildOfferReply(state, changeType) {
  const ack = getChangeAcknowledgement(changeType, state);

  if (!state.location_text) {
    return `${ack}
¿En qué zona, colonia o municipio está la propiedad?`;
  }

  if (state.geo_qualified === false || state.value_qualified === false) {
    return buildOfferRejectedReply(state);
  }

  if (state.budget_max == null) {
    return `${ack}
¿Cuál es tu precio estimado?`;
  }

  if (!state.budget_currency) {
    return `${ack}
¿Ese monto es en MXN o USD?`;
  }

  if (state.owner_relation == null) {
    return `${ack}
¿La propiedad es tuya o estás apoyando a alguien?`;
  }

  if (!state.property_type) {
    return `${ack}
¿Qué tipo de propiedad es?`;
  }

  if (!state.full_name) {
    return `${ack}
¿Me compartes tu nombre completo?`;
  }

  if (!state.contact_preference) {
    return `${ack}
¿Prefieres que te contacten por WhatsApp o por llamada?`;
  }

  if (state.contact_number_confirmed == null) {
    return `${ack}
¿Este es el mejor número para contactarte?`;
  }

  return buildFinalHandoffReply(state);
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
- Mantén tono premium y amable.
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