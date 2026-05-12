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

  if (shouldExitPropertyMode(text, prev)) {
    return {
      __clearPropertyIntent: true,
      property_code: null,
      direct_property_code: null,
      direct_property_reference: false,
      property_specific_intent: false,
      interested_property_id: null,
      property_context: null,
    };
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

function formatMoneyMx(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString('es-MX')}`;
  }
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

function isVisitIntentText(text) {
  const t = normalizeText(text);
  if (!t) return false;
  const phrases = [
    'quiero verla',
    'quiero verlo',
    'quiero ver la propiedad',
    'quiero visitar',
    'quiero visitarla',
    'quiero visitarlo',
    'agendar visita',
    'agendar una visita',
    'agendar cita',
    'quiero una cita',
    'quiero ir a verla',
    'quiero ir a verlo',
    'la quiero ver',
    'lo quiero ver',
  ];
  if (phrases.some((p) => t.includes(p))) return true;
  if (t.includes('quiero ver') && (t.includes('casa') || t.includes('propiedad') || t.includes('depa'))) return true;
  return false;
}

/**
 * Respuesta consultiva en modo propiedad (sin inventar disponibilidad).
 * @param {{ text: string, aiState: object, propertyRow: object|null, hasValidName?: boolean }} opts
 * @returns {string}
 */
function buildPropertyModeReply(opts = {}) {
  const { text = '', aiState = {}, propertyRow = null, hasValidName = false } = opts;
  const t = normalizeText(text);
  const code = cleanSpaces(String(aiState.property_code || aiState.direct_property_code || ''));
  const displayCode = cleanSpaces(String(propertyRow?.listing_id || code || ''));

  if (!propertyRow || !propertyRow.id) {
    const c = displayCode || code;
    return `No encontré una propiedad activa con el código ${c}. Si quieres, puedo ayudarte a revisar otras opciones similares.`;
  }

  if (t.includes('precio') || t.includes('cuesta') || t.includes('valor')) {
    const p = pickNumericPrice(propertyRow);
    if (p != null) {
      const tail = hasValidName
        ? '¿Te gustaría agendar una visita o que un asesor te comparta más detalle?'
        : 'Para registrarte bien, ¿me compartes tu nombre? Y si quieres, te canalizo con un asesor para agendar visita.';
      return `El precio que veo en sistema para ${displayCode} es ${formatMoneyMx(p)}. ${tail}`;
    }
    return `Sobre ${displayCode}, no tengo un precio numérico verificado en esta conversación; un asesor lo confirma con el inventario al día.`;
  }

  if (t.includes('disponible') || t.includes('disponibilidad')) {
    return `Para disponibilidad al día de hoy de ${displayCode}, un asesor lo confirma en sistema; yo no cierro disponibilidad aquí sin ese dato. Si quieres, te canalizo con un asesor para validarlo.`;
  }

  if (isVisitIntentText(text) || t.includes('verla') || t.includes('verlo') || t.includes('visita')) {
    const tail = hasValidName
      ? '¿Qué día y horario te conviene más para agendar?'
      : 'Para registrarte bien, ¿me compartes tu nombre? Así un asesor puede agendar visita contigo.';
    return `Perfecto. Para ${displayCode} puedo canalizarte con un asesor para agendar visita o revisar horarios. ${tail}`;
  }

  const tail = hasValidName
    ? '¿Te gustaría que te comparta detalles, precio, ubicación o agendar una visita?'
    : '¿Te gustaría que te comparta detalles, precio, ubicación o agendar una visita? Para registrarte bien, ¿me compartes tu nombre?';
  return `Claro, ya ubiqué la propiedad ${displayCode}. ${tail}`;
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
