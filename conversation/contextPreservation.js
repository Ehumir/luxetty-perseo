'use strict';

/**
 * contextPreservation.js
 *
 * Helpers para preservar y reutilizar contexto conversacional
 * a lo largo de múltiples mensajes en la misma conversación.
 *
 * Problema que resuelve:
 *   - Usuario envía "Hola, quiero vender mi casa en Cumbres."
 *   - Se detecta intención de venta/oferta
 *   - Usuario envía "Está cerca de Leones y tiene 3 recámaras."
 *   - PERSEO debe mantener la intención anterior y agregar los nuevos datos,
 *     en lugar de reiniciar la conversación.
 */

const { normalizeText } = require('../utils/text');

/**
 * Determina si un nuevo mensaje es una continuación
 * (agrega detalles) vs. un cambio de intención.
 *
 * @param {string} newText
 * @param {object} previousAiState
 * @returns {boolean}
 */
function isDetailContinuation(newText = '', previousAiState = {}) {
  const text = normalizeText(newText || '');
  const prevFlowType = previousAiState?.lead_flow;

  // Si no hay flow previo, no es continuación
  if (!prevFlowType) return false;

  // Palabras clave que indican continuación (detalles)
  const detailKeywords = [
    'recamara', 'habitacion', 'bano', 'cochera', 'estacionamiento',
    'cerca de', 'zone', 'ubicacion', 'ubicación', 'calle', 'avenida',
    'metros', 'm2', 'm²', 'tamano', 'tamaño', 'superficie',
    'piso', 'nivel', 'lote', 'terreno', 'altura',
    'precio', 'valuo', 'valuacion', 'costo', 'renta',
    'constructo', 'antiguedad', 'antigüedad', 'ano', 'año',
    'acabado', 'material', 'pared', 'techo', 'piso',
    'amueblado', 'sin amueblar', 'equipo',
    'caracteristica', 'característica', 'tiene', 'cuenta',
    'tambien', 'también', 'ademas', 'además', 'incluye',
    'pronto', 'rapido', 'rápido', 'disponible', 'libre',
    'telefono', 'teléfono', 'me llamen', 'contacten',
  ];

  // Si contiene palabras de detalle, es continuación
  const hasDetailKeyword = detailKeywords.some((kw) => text.includes(kw));
  if (hasDetailKeyword) return true;

  // Si es muy corto y el mensaje anterior registra datos útiles, puede ser continuación
  if (text.length < 50 && (
    previousAiState?.location_text ||
    previousAiState?.property_type ||
    previousAiState?.budget_max ||
    previousAiState?.bedrooms
  )) {
    return true;
  }

  // Si no contradice el flow anterior, es continuación
  const contradicts = (
    (prevFlowType === 'offer' && text.includes('quiero comprar')) ||
    (prevFlowType === 'demand' && text.includes('quiero vender'))
  );

  return !contradicts;
}

/**
 * Fusiona el estado anterior con el nuevo detectado,
 * preservando datos útiles que el usuario ya mencionó.
 *
 * @param {object} newDetectedIntent
 * @param {object} previousAiState
 * @param {object} currentSignals
 * @returns {object}
 */
function mergeIntentWithPreviousState(newDetectedIntent = {}, previousAiState = {}, currentSignals = {}) {
  const merged = { ...newDetectedIntent };

  // Si el nuevo intent es "unknown" o vacío, preservar el anterior
  if (!merged.lead_flow && previousAiState?.lead_flow) {
    merged.lead_flow = previousAiState.lead_flow;
    merged.operation_type = previousAiState.operation_type || merged.operation_type;
    merged.intent_type = previousAiState.intent_type || merged.intent_type;
    merged.category = previousAiState.lead_flow === 'offer' ? 'offer' : 'demand';
  }

  // Preservar location si ya se tiene
  if (previousAiState?.location_text && !currentSignals?.location_text) {
    merged.location_text = previousAiState.location_text;
  }

  // Preservar property type si ya se tiene
  if (previousAiState?.property_type && !currentSignals?.property_type) {
    merged.property_type = previousAiState.property_type;
  }

  // Preservar budget si ya se tiene
  if (previousAiState?.budget_max && !currentSignals?.budget_max) {
    merged.budget_max = previousAiState.budget_max;
  }

  // Preservar bedrooms si ya se tienen
  if (previousAiState?.bedrooms && !currentSignals?.bedrooms) {
    merged.bedrooms = previousAiState.bedrooms;
  }

  return merged;
}

/**
 * Extrae de previousAiState una lista de datos ya capturados
 * para evitar preguntar de nuevo.
 *
 * @param {object} previousAiState
 * @returns {array}
 */
function extractCapturedDataFromState(previousAiState = {}) {
  const captured = [];

  if (previousAiState?.contact_first_name) captured.push('nombre');
  if (previousAiState?.location_text) captured.push(`zona: ${previousAiState.location_text}`);
  if (previousAiState?.property_type) captured.push(`tipo: ${previousAiState.property_type}`);
  if (previousAiState?.bedrooms) captured.push(`${previousAiState.bedrooms} recámaras`);
  if (previousAiState?.bathrooms) captured.push(`${previousAiState.bathrooms} baños`);
  if (previousAiState?.budget_max) captured.push(`presupuesto: $${previousAiState.budget_max.toLocaleString()}`);
  if (previousAiState?.lead_phone) captured.push(`teléfono: ${previousAiState.lead_phone}`);

  return captured;
}

/**
 * Determina si debemos continuar pidiendo datos
 * o si debemos confirmar canalización.
 *
 * @param {object} intent
 * @param {object} previousAiState
 * @returns {string} 'ask_next_field' | 'confirm_handoff' | 'ask_multiple'
 */
function decideNextConversationStep(intent = {}, previousAiState = {}) {
  const flowType = intent.lead_flow || previousAiState?.lead_flow;

  if (flowType === 'demand') {
    // Para demanda: necesitamos presupuesto, zona, tipo de propiedad, recámaras, nombre, teléfono
    if (!previousAiState?.budget_max && !previousAiState?.budget_min) return 'ask_budget';
    if (!previousAiState?.location_text) return 'ask_zone';
    if (!previousAiState?.contact_first_name) return 'ask_name';
    if (!previousAiState?.lead_phone) return 'ask_phone';
    return 'confirm_handoff';
  }

  if (flowType === 'offer') {
    // Para oferta: necesitamos location, tipo, recámaras, baños, precio, nombre, teléfono
    if (!previousAiState?.location_text) return 'ask_zone';
    if (!previousAiState?.property_type) return 'ask_property_type';
    if (!previousAiState?.contact_first_name) return 'ask_name';
    if (!previousAiState?.lead_phone) return 'ask_phone';
    return 'confirm_handoff';
  }

  return 'ask_multiple';
}

module.exports = {
  isDetailContinuation,
  mergeIntentWithPreviousState,
  extractCapturedDataFromState,
  decideNextConversationStep,
};
