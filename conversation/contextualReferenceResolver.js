'use strict';

const { normalizeText, cleanSpaces } = require('../utils/text');
const { extractPropertyCode } = require('./propertyIntentResolver');

/**
 * Resuelve pronombres y deíxis ("esa", "esta", "la otra") a código de propiedad usando ai_state e historial.
 * @param {object} opts
 * @param {string} opts.text
 * @param {object} opts.aiState
 * @param {object[]} [opts.recentMessages]
 * @returns {{ propertyCode: string|null, referenceType: string|null, contextual_reference: string|null }}
 */
function resolveContextualPropertyCode({ text, aiState = {}, recentMessages = [] } = {}) {
  const raw = cleanSpaces(String(text || ''));
  if (!raw) return { propertyCode: null, referenceType: null, contextual_reference: null };

  if (extractPropertyCode(raw)) {
    return { propertyCode: null, referenceType: null, contextual_reference: null };
  }

  const t = normalizeText(raw);
  const hist = Array.isArray(aiState.property_history) ? aiState.property_history : [];
  const fromHistory = (idx) => cleanSpaces(String(hist[idx]?.code || ''));

  if (/\bla otra\b|\bel otro\b/.test(t) && hist.length >= 2) {
    const c = fromHistory(1);
    if (c) return { propertyCode: c, referenceType: 'ordinal_other', contextual_reference: 'la otra' };
  }

  if (!messageUsesPropertyDeixis(t)) {
    return { propertyCode: null, referenceType: null, contextual_reference: null };
  }

  const anchor =
    cleanSpaces(String(aiState.current_property_code || aiState.contextual_subject_code || '')) ||
    fromHistory(0) ||
    cleanSpaces(String(aiState.property_code || aiState.direct_property_code || ''));

  if (!anchor) return { propertyCode: null, referenceType: null, contextual_reference: null };

  return {
    propertyCode: anchor,
    referenceType: 'deictic_property',
    contextual_reference: t.slice(0, 80),
  };
}

function messageUsesPropertyDeixis(t) {
  return (
    /\b(esa|esta|aquella|ese|esos|esas)\s+(propiedad|casa|depa|depto|departamento|vivienda|ficha|inmueble)\b/.test(t) ||
    /\b(esa|esta|aquella)\s+(propiedad|casa|depa|depto)\b/.test(t) ||
    /\b(esa propiedad|esa casa|esta propiedad|esta casa|esa ficha)\b/.test(t) ||
    (/\b(esa|esta|aquella)\b/.test(t) && /\besta en\b|\bestá en\b/.test(t)) ||
    /\bla otra\b|\bel otro\b/.test(t)
  );
}

/**
 * Señales listas para Object.assign sobre parsedSignals.
 * @param {{ propertyCode: string|null, referenceType?: string|null }} resolved
 * @returns {object}
 */
function buildPropertySignalsFromResolution(resolved) {
  const code = cleanSpaces(String(resolved?.propertyCode || ''));
  if (!code) return {};
  return {
    property_code: code,
    direct_property_code: code,
    direct_property_reference: true,
    property_specific_intent: true,
    contextual_subject: 'property_listing',
    contextual_reference: resolved?.referenceType || 'deictic_property',
  };
}

module.exports = {
  resolveContextualPropertyCode,
  buildPropertySignalsFromResolution,
  messageUsesPropertyDeixis,
};
