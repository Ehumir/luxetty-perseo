'use strict';

/**
 * R0 / P0.1.2 — Context Continuity Guardrail (sin Stage Engine ni Decision Core).
 * El estado persistido (offer / sale) manda sobre señales frágiles del turno actual.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const { isLikelyShortPersonNameToken } = require('./antiLoopGuardrails');

/**
 * Hilo de captación/venta protegido.
 * Nota: en `intent.js`, un comprador (demand) también recibe `operation_type === 'sale'`
 * (compra vs renta). Por eso NO basta con `operation_type === 'sale'` sin más.
 */
function isR0StickySaleCaptureThread(aiState = {}) {
  const st = aiState && typeof aiState === 'object' ? aiState : {};
  if (st.lead_flow === 'offer') return true;
  if (st.lead_flow === 'demand' && st.operation_type === 'sale') {
    const hasBuyerBudget = st.budget_max != null && Number.isFinite(Number(st.budget_max));
    if (hasBuyerBudget) return false;
    if (st.expected_price != null && Number.isFinite(Number(st.expected_price))) return true;
    if (st.sale_motivation != null && String(st.sale_motivation).trim()) return true;
    if (st.is_exploring_sale === true) return true;
  }
  return false;
}

/**
 * El usuario indica claramente que quiere pasar a búsqueda/compra/renta.
 */
function explicitDemandSearchIntent(text = '') {
  const t = normalizeText(String(text || ''));
  if (!t) return false;
  return (
    /\bbusco\b/.test(t) ||
    /\bbuscar\b/.test(t) ||
    t.includes('quiero comprar') ||
    t.includes('quiero rentar') ||
    t.includes('quiero arrendar') ||
    t.includes('en realidad busco') ||
    t.includes('no quiero vender') ||
    t.includes('no es venta') ||
    t.includes('tambien quiero comprar') ||
    t.includes('también quiero comprar') ||
    t.includes('ademas quiero rentar') ||
    t.includes('además quiero rentar') ||
    (t.includes('renta') && t.includes('busco')) ||
    (t.includes('compra') && t.includes('busco'))
  );
}

/**
 * Antes de `buildNextState`: evita que el parser vuelque offer/sale → demand ni `budget_max` de comprador
 * por mensajes cortos (número, zona, nombre, ok).
 */
function applyR0StickySignalsGuard(previousAiState = {}, parsedSignals = {}, inboundText = '') {
  const sig = parsedSignals && typeof parsedSignals === 'object' ? { ...parsedSignals } : {};
  const prev = previousAiState && typeof previousAiState === 'object' ? previousAiState : {};
  if (!isR0StickySaleCaptureThread(prev)) return sig;
  if (explicitDemandSearchIntent(inboundText)) return sig;

  if (sig.lead_flow === 'demand') {
    delete sig.lead_flow;
  }

  if (sig.budget_max != null && Number.isFinite(Number(sig.budget_max))) {
    const b = Number(sig.budget_max);
    if (sig.expected_price == null || !Number.isFinite(Number(sig.expected_price))) {
      sig.expected_price = b;
    }
    delete sig.budget_max;
  }

  return sig;
}

/**
 * Fallback consultivo cuando el hilo ya es venta/captación y el mensaje no es cambio explícito a demanda.
 */
function buildSaleCaptiveContinuityReply({ text = '', aiState = {}, loc = '', hasValidHumanName = false } = {}) {
  const raw = cleanSpaces(String(text || ''));
  const t = normalizeText(raw);
  const st = aiState && typeof aiState === 'object' ? aiState : {};
  const zone = cleanSpaces(String(loc || st.location_text || ''));
  const typeLabel =
    st.property_type && String(st.property_type).trim() && String(st.property_type) !== 'null'
      ? String(st.property_type)
      : 'propiedad';
  const priceHint =
    st.expected_price != null && Number.isFinite(Number(st.expected_price))
      ? Number(st.expected_price)
      : null;

  if (!t || t === 'si' || t === 'sí' || t === 'ok' || t === 'vale') {
    return zone
      ? `Listo, seguimos con la venta en ${zone}. ¿Quieres afinar tipo de inmueble o motivación de venta?`
      : 'Listo, seguimos con la venta. ¿En qué colonia o municipio está la propiedad?';
  }

  if (isLikelyShortPersonNameToken(raw) && raw.split(/\s+/).filter(Boolean).length <= 2) {
    const cap = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    const z = zone ? ` en ${zone}` : '';
    return `Gracias, ${cap}. Sigo con tu venta${z}. ¿El inmueble es casa, departamento o terreno?`;
  }

  if (/\d/.test(raw) && (t.includes('millon') || t.includes('mdp') || /\b\d/.test(t))) {
    return zone
      ? `Con lo que comentas sobre la venta en ${zone}, sigo sin prometer precios de mercado aquí. ¿Tipo de inmueble y si está habitada o libre?`
      : `Perfecto, con ese monto como referencia. ¿En qué colonia o municipio está la propiedad?`;
  }

  if (zone || t.includes('cumbres') || t.includes('zona') || t.includes('colonia') || t.includes('municipio')) {
    const z2 = zone || (raw.length < 80 ? raw : '');
    return z2
      ? `Perfecto, tomé la zona (${z2}). Sigo con la venta de tu ${typeLabel}. ¿Está habitada, rentada o libre?`
      : `Sigo con la venta de tu ${typeLabel}. ¿En qué colonia o municipio está?`;
  }

  if (priceHint != null) {
    return `Sigo con la venta de tu ${typeLabel}. ¿En qué colonia o municipio está la propiedad?`;
  }

  return `Sigo con la venta de tu ${typeLabel}. Cuéntame en una línea qué quieres afinar (zona, tipo o estado del inmueble).`;
}

module.exports = {
  isR0StickySaleCaptureThread,
  explicitDemandSearchIntent,
  applyR0StickySignalsGuard,
  buildSaleCaptiveContinuityReply,
};
