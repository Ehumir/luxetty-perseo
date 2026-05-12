'use strict';

const { normalizeText, cleanSpaces } = require('../utils/text');

/**
 * Normaliza cualquier variante reconocida a LUX-A0461 (letra + 4 dígitos).
 * @param {string|null|undefined} rawValue
 * @returns {string|null}
 */
function normalizePropertyCode(rawValue) {
  if (!rawValue) return null;

  const text = String(rawValue)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—−_./,#:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const fullMatch = text.match(/\bLUX\s*([A-Z])\s*(\d{4})\b/);
  if (fullMatch) {
    return `LUX-${fullMatch[1]}${fullMatch[2]}`;
  }

  const shortMatch = text.match(/\b([A-Z])\s*(\d{4})\b/);
  if (shortMatch) {
    return `LUX-${shortMatch[1]}${shortMatch[2]}`;
  }

  return null;
}

/**
 * Extrae código de propiedad del texto (LUX-A0461, A0461, la A0461, propiedad 461, etc.).
 * @param {string} message
 * @returns {string|null}
 */
function extractPropertyCode(message) {
  const raw = cleanSpaces(message || '');
  if (!raw) return null;

  const normalized = normalizePropertyCode(raw);
  if (normalized) return normalized;

  const upperRaw = raw.toUpperCase();

  const patterns = [
    /\bLA\s+([A-Z])\s*(\d{3,4})\b/,
    /\b(?:PROPIEDAD|CASA|DEPA|DEPTO|DEPARTAMENTO)\s+([A-Z])\s*(\d{3,4})\b/,
    /\b(?:PROPIEDAD|CASA|DEPA|DEPTO|DEPARTAMENTO)\s*[:#-]?\s*(LUX[\s\-]?[A-Z]\s?[0-9]{4}|[A-Z][0-9]{4})\b/i,
    /\b(?:PROPIEDAD|ID|CODIGO|COD)\s*[:#-]?\s*(LUX[\s\-]?[A-Z]\s?[0-9]{4}|[A-Z][0-9]{4})\b/i,
    /\b(LUX[\s\-]?[A-Z]\s?[0-9]{4}|[A-Z][0-9]{4})\b/i,
  ];

  for (const pattern of patterns) {
    const match = upperRaw.match(pattern) || raw.match(pattern);
    if (!match) continue;
    let candidate = match[1];
    if (match[2] != null) {
      const letter = String(match[1] || '').toUpperCase();
      let digits = String(match[2] || '').replace(/\D/g, '');
      if (!/^[A-Z]$/.test(letter) || !digits) continue;
      if (digits.length === 3) digits = digits.padStart(4, '0');
      if (digits.length !== 4) continue;
      candidate = `${letter}${digits}`;
    }
    const parsed = normalizePropertyCode(candidate);
    if (parsed) return parsed;
  }

  const numOnly = upperRaw.match(
    /\b(?:PROPIEDAD|CASA|DEPA|DEPTO|DEPARTAMENTO)\s+(\d{3,4})\b/
  );
  if (numOnly?.[1]) {
    let digits = String(numOnly[1]).replace(/\D/g, '');
    if (digits.length === 3) digits = digits.padStart(4, '0');
    if (digits.length === 4) {
      const parsed = normalizePropertyCode(`A${digits}`);
      if (parsed) return parsed;
    }
  }

  return null;
}

function shouldExitPropertyMode(text, aiState = {}) {
  if (!isPropertySpecificConversation(aiState)) return false;
  const t = normalizeText(text);
  if (!t) return false;

  if (extractPropertyCode(text)) return false;

  if (/\bya no\b/.test(t) && (/\b(es[ao]|esa|eso)\b/.test(t) || t.includes('esa') || t.includes('eso'))) return true;
  if (t.includes('mejor busco') || t.includes('mejor buscar')) return true;
  if (
    (t.includes('busco casa') ||
      t.includes('busco depa') ||
      t.includes('busco departamento') ||
      t.includes('busco en ')) &&
    !extractPropertyCode(text)
  ) {
    return true;
  }

  return false;
}

/**
 * Parche plano para mezclar con señales parseadas (Object.assign).
 * @param {string} text
 * @param {object} aiState
 * @returns {object}
 */
function resolvePropertyIntent(text, aiState = {}) {
  const prev = aiState && typeof aiState === 'object' ? aiState : {};
  const t = normalizeText(text);

  if (isPropertySpecificConversation(prev) && !extractPropertyCode(text)) {
    const { shouldSoftExitPropertyToBuyerSearch } = require('./conversationalStateMachine');
    if (shouldSoftExitPropertyToBuyerSearch(text)) {
      return {
        __softExitPropertyMode: true,
        property_specific_intent: false,
        direct_property_reference: false,
        property_code: null,
        direct_property_code: null,
      };
    }
  }

  if (shouldExitPropertyMode(text, prev)) {
    return {
      __clearPropertyIntent: true,
      property_code: null,
      direct_property_code: null,
      direct_property_reference: false,
      property_specific_intent: false,
      interested_property_id: null,
      property_context: null,
      current_property_code: null,
      current_interested_property_id: null,
      property_history: [],
      property_context_by_code: {},
    };
  }

  if (isPropertySpecificConversation(prev)) {
    const hist = Array.isArray(prev.property_history) ? prev.property_history : [];
    if (hist.length && (/\bla\s+primera\b|\bprimera\s+propiedad\b|\bel\s+primero\b/.test(t) || /\bprimera\b/.test(t))) {
      const c = cleanSpaces(String(hist[hist.length - 1]?.code || ''));
      if (c) {
        return {
          property_code: c,
          direct_property_code: c,
          direct_property_reference: true,
          property_specific_intent: true,
        };
      }
    }
    if (hist.length && (/\bla\s+ultima\b|\bla\s+ultima\b|\blo\s+ultimo\b|\bulimo\b/.test(t) || /\bultima\b/.test(t))) {
      const c = cleanSpaces(String(hist[0]?.code || ''));
      if (c) {
        return {
          property_code: c,
          direct_property_code: c,
          direct_property_reference: true,
          property_specific_intent: true,
        };
      }
    }
  }

  const code = extractPropertyCode(text);
  if (!code) return {};

  return {
    property_code: code,
    direct_property_code: code,
    direct_property_reference: true,
    property_specific_intent: true,
  };
}

function isPropertySpecificConversation(aiState = {}) {
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  const code = cleanSpaces(String(s.property_code || s.direct_property_code || ''));
  if (!code) return false;
  if (s.property_specific_intent) return true;
  if (s.direct_property_reference) return true;
  return false;
}

function pickNumericPrice(row) {
  if (!row || typeof row !== 'object') return null;
  const keys = ['price', 'sale_price', 'selling_price', 'rent_price', 'rent_amount', 'list_price'];
  for (const k of keys) {
    const v = row[k];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/**
 * Respuesta consultiva en modo propiedad (delega en propertySpecificFlow).
 * @param {{ text: string, aiState: object, propertyRow: object|null, hasValidName?: boolean, recentMessages?: object[], contact?: object, waProfileName?: string|null }} opts
 * @returns {string}
 */
function buildPropertyModeReply(opts = {}) {
  const propertySpecificFlow = require('./propertySpecificFlow');
  const intent = propertySpecificFlow.classifyPropertyFollowUp(
    opts.text || '',
    opts.aiState || {},
    opts.recentMessages || []
  );
  return propertySpecificFlow.buildPropertySpecificReply({
    intent,
    property: opts.propertyRow === undefined ? null : opts.propertyRow,
    aiState: opts.aiState || {},
    contact: opts.contact || null,
    waProfileName: opts.waProfileName || null,
    text: opts.text || '',
    recentMessages: opts.recentMessages || [],
    hasValidName: opts.hasValidName,
  });
}

module.exports = {
  normalizePropertyCode,
  extractPropertyCode,
  resolvePropertyIntent,
  isPropertySpecificConversation,
  shouldExitPropertyMode,
  buildPropertyModeReply,
  pickNumericPrice,
};
