'use strict';

/**
 * Extrae varias señales comerciales del mismo mensaje (nombre + presupuesto, etc.)
 * sin depender solo del parser secuencial.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const { isUsefulContactName, isInvalidContactName } = require('../utils/helpers');
const { extractMaxPrice, extractBedrooms } = require('./parsers');

function parseBedroomsFromCuartos(text) {
  const t = normalizeText(text);
  const m = t.match(/(\d+)\s*(cuartos?|habitaciones?|recamaras?|recámaras?)/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 20 ? n : null;
}

function parseMdpBudget(text) {
  const t = normalizeText(text);
  const m = t.match(/\b(\d+(?:[.,]\d+)?)\s*mdp\b/);
  if (!m?.[1]) return null;
  const value = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000);
}

const NAME_BLOCKLIST = new Set(
  [
    'casa',
    'casas',
    'depa',
    'depas',
    'departamento',
    'departamentos',
    'terreno',
    'terrenos',
    'lote',
    'lotes',
    'cumbres',
    'monterrey',
    'guadalupe',
    'apodaca',
    'escobedo',
    'garcia',
    'santa catarina',
    'san pedro',
    'mitras',
    'centro',
    'centrito',
    'valle',
    'chihuahua',
    'saltillo',
    'alberca',
    'piscina',
    'patio',
    'bodega',
    'fraccionamiento',
    'privada',
    'millon',
    'millones',
    'mdp',
    'pesos',
    'mxn',
    'usd',
    'cliente',
    'usuario',
    'venta',
    'renta',
    'rentar',
    'comprar',
    'vender',
    'busco',
    'quiero',
    'hola',
    'buenas',
    'opciones',
    'informacion',
    'información',
  ].map((s) => normalizeText(s))
);

function isLikelyPersonGivenName(token) {
  const t = cleanSpaces(String(token || ''));
  if (!t || t.length < 2 || t.length > 40) return false;
  const low = normalizeText(t);
  if (NAME_BLOCKLIST.has(low)) return false;
  if (/\d/.test(t)) return false;
  if (!isUsefulContactName(t) || isInvalidContactName(t)) return false;
  return true;
}

/**
 * @returns {object} solo claves detectadas (sparse)
 */
function extractMultiSignals(message, previousAiState = {}) {
  const raw = cleanSpaces(String(message || ''));
  if (!raw) return {};
  const out = {};
  const t = normalizeText(raw);

  const commaLead = raw.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,28})\s*,\s*(.+)$/);
  if (commaLead) {
    const cand = cleanSpaces(commaLead[1]);
    const rest = commaLead[2];
    if (isLikelyPersonGivenName(cand)) {
      out.full_name = cand;
      const b = extractMaxPrice(rest) ?? parseMdpBudget(rest);
      if (b != null && Number.isFinite(b)) out.budget_max = b;
      const br = extractBedrooms(rest) ?? parseBedroomsFromCuartos(rest);
      if (br != null && Number.isFinite(br)) out.bedrooms = br;
    }
  }

  const habla = raw.match(/\b(?:habla|te habla)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,28})\b/i);
  if (habla?.[1] && isLikelyPersonGivenName(habla[1]) && !out.full_name) {
    out.full_name = cleanSpaces(habla[1]);
  }

  const nameY = raw.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,28})\s+y\s+(quiero|busco|necesito|voy|soy)\b/i);
  if (nameY?.[1] && isLikelyPersonGivenName(nameY[1]) && !out.full_name) {
    out.full_name = cleanSpaces(nameY[1]);
    if (/vender|venta|valu|vendo/i.test(raw)) out.lead_flow = 'offer';
    else if (/busco|comprar|rentar|renta|quiero casa|quiero depa/i.test(raw)) out.lead_flow = 'demand';
  }

  const soyY = raw.match(/^soy\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,28})\s+y\s+/i);
  if (soyY?.[1] && isLikelyPersonGivenName(soyY[1]) && !out.full_name) {
    out.full_name = cleanSpaces(soyY[1]);
    if (/vender|venta|valu|vendo/i.test(raw)) out.lead_flow = 'offer';
    else if (/busco|comprar|rentar|renta|casa|depa/i.test(raw)) out.lead_flow = 'demand';
  }

  const bAll = extractMaxPrice(raw) ?? parseMdpBudget(raw);
  const brAll = extractBedrooms(raw) ?? parseBedroomsFromCuartos(raw);
  if (bAll != null && out.budget_max == null) out.budget_max = bAll;
  if (brAll != null && out.bedrooms == null) out.bedrooms = brAll;

  if (out.full_name && /vender|venta|valu|vendo/i.test(t) && !out.lead_flow) {
    out.lead_flow = 'offer';
  }

  return out;
}

function parserFullNameLooksLikePhraseBleed(s) {
  const t = normalizeText(String(s || ''));
  if (!t) return false;
  return (
    t.includes('busco') ||
    t.includes('quiero') ||
    t.includes('necesito') ||
    t.includes('casa en') ||
    t.includes('depa en') ||
    t.includes('en cumbres') ||
    t.includes('en monterrey')
  );
}

/**
 * Fusiona señales multi sobre el resultado de parseMessageSignals sin pisar valores útiles del parser.
 */
function mergeSignalsWithMulti(baseSignals, multiPartial) {
  const b = baseSignals && typeof baseSignals === 'object' ? baseSignals : {};
  const m = multiPartial && typeof multiPartial === 'object' ? multiPartial : {};
  const out = { ...b };
  for (const [k, v] of Object.entries(m)) {
    if (v === undefined || v === null) continue;
    if (k === 'full_name' && typeof v === 'string' && cleanSpaces(v)) {
      const nv = cleanSpaces(v);
      const existing = cleanSpaces(String(out.full_name || ''));
      if (!existing) out.full_name = nv;
      else if (commaPatternLikelyNameMessage(b, m)) out.full_name = nv;
      else if (parserFullNameLooksLikePhraseBleed(existing)) out.full_name = nv;
      continue;
    }
    if (k === 'budget_max' && Number.isFinite(Number(v))) {
      if (out.budget_max == null || !Number.isFinite(Number(out.budget_max))) out.budget_max = Number(v);
      continue;
    }
    if (k === 'bedrooms' && Number.isFinite(Number(v))) {
      if (out.bedrooms == null || !Number.isFinite(Number(out.bedrooms))) out.bedrooms = Number(v);
      continue;
    }
    if (k === 'location_text' && cleanSpaces(String(v))) {
      if (!cleanSpaces(String(out.location_text || ''))) out.location_text = cleanSpaces(String(v));
      continue;
    }
    if (k === 'lead_flow' && (v === 'demand' || v === 'offer')) {
      if (!out.lead_flow) out.lead_flow = v;
      continue;
    }
    if (k === 'operation_type' && v) {
      if (!out.operation_type) out.operation_type = v;
    }
  }
  return out;
}

function commaPatternLikelyNameMessage(base, multi) {
  return !!(multi && multi.full_name && multi.budget_max != null && !base?.full_name);
}

module.exports = {
  extractMultiSignals,
  mergeSignalsWithMulti,
  isLikelyPersonGivenName,
};
