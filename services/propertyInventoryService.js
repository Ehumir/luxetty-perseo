'use strict';

const { normalizeText, cleanSpaces } = require('../utils/text');
const { formatMoney } = require('../utils/formatting');
const { extractPropertyCode, pickNumericPrice } = require('../conversation/propertyIntentResolver');

const LUXETTY_PUBLIC_ORIGIN = 'https://luxetty.com';

/** Select tiers: widest first; on PostgREST column errors, fall back (read-only). */
const SELECT_TIERS = [
  'id, listing_id, public_code, code, folio, slug, title, operation_type, price, sale_price, selling_price, rent_price, rent_amount, currency_code, currency, status, is_active, published, visible_on_website, city, neighborhood, municipality, zone, bedrooms, bathrooms, construction_m2, terrain_m2, property_type, property_category, highlights, public_highlights, amenities, cover_image_url, agent_profile_id, responsible_agent_profile_id',
  'id, listing_id, slug, title, operation_type, price, sale_price, selling_price, rent_price, rent_amount, status, bedrooms, bathrooms, city, neighborhood, municipality, zone, property_type, property_category, terrain_m2, construction_m2, highlights, amenities, agent_profile_id',
  'id, listing_id, slug, title, operation_type, price, sale_price, selling_price, rent_price, rent_amount, status, bedrooms, bathrooms, city, neighborhood, municipality, property_type, terrain_m2, construction_m2, agent_profile_id',
  'id, listing_id, operation_type, agent_profile_id, price, sale_price, selling_price, rent_price, rent_amount, status, bedrooms, bathrooms, city, neighborhood, title, slug, property_type, terrain_m2, construction_m2',
  'id, listing_id, operation_type, agent_profile_id, price, sale_price, slug, title, neighborhood, city',
  'id, listing_id, slug, title, operation_type, price, status, neighborhood, city',
];

function logInventoryFallback(logger, reason, extra = {}) {
  const w = logger && typeof logger.warn === 'function' ? logger.warn.bind(logger) : console.warn;
  w('property_inventory_select_fallback', { reason, ...extra });
}

function normalizeInventoryCode(raw) {
  if (raw == null) return null;
  const c = String(raw).trim().toUpperCase();
  if (!c) return null;
  if (c.startsWith('LUX-')) return c;
  const m = c.match(/^([A-Z])(\d{4})$/);
  if (m) return `LUX-${m[1]}${m[2]}`;
  return c;
}

function isUuidLike(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || '').trim());
}

function stripSupabaseNoiseFromSlug(slug) {
  if (slug == null || typeof slug !== 'string') return '';
  const s = slug.trim();
  if (!s) return '';
  if (/supabase\.co|storage\.googleapis\.com|amazonaws\.com/i.test(s)) return '';
  return s;
}

/**
 * URL pública obligatoria: solo luxetty.com/propiedad/{slug}
 * @param {object} property — fila o normalizado con slug
 * @returns {string|null}
 */
function buildPublicPropertyUrl(property = {}) {
  const rawSlug = stripSupabaseNoiseFromSlug(property.slug);
  if (!rawSlug || /\s/.test(rawSlug)) return null;
  const cleanSlug = rawSlug
    .replace(/^https?:\/\/(?:www\.)?luxetty\.com\/propiedad\//i, '')
    .replace(/^\/?propiedad\//i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!cleanSlug || /\s/.test(cleanSlug)) return null;
  if (/^https?:\/\//i.test(cleanSlug)) return null;
  return `${LUXETTY_PUBLIC_ORIGIN}/propiedad/${cleanSlug}`;
}

function propertyHasPublicLink(property = {}) {
  return !!buildPublicPropertyUrl(property);
}

function propertyHasPrice(property = {}) {
  return pickNumericPrice(property) != null;
}

function propertyOperationLabel(property = {}) {
  const op = String(property.operation_type || property.operation || '').toLowerCase();
  if (op === 'rent' || op === 'rental') return 'en renta';
  if (op === 'sale' || op === 'sell' || op === 'venta') return 'en venta';
  if (op === 'sale_rent' || op === 'both') return 'en venta y en renta';
  return 'operación no confirmada en inventario';
}

function getPropertyPublicFacts(property = {}) {
  const p = property && typeof property === 'object' ? property : {};
  return {
    code: cleanSpaces(String(p.listing_id || p.code || '')) || null,
    slug: stripSupabaseNoiseFromSlug(p.slug) || null,
    title: p.title || null,
    operation_type: p.operation_type || null,
    operation_label: propertyOperationLabel(p),
    price: pickNumericPrice(p),
    public_url: buildPublicPropertyUrl(p),
    location_label:
      cleanSpaces(
        String(p.neighborhood || p.zone || p.municipality || p.city || p.location_label || '')
      ) || null,
    bedrooms: p.bedrooms != null && Number.isFinite(Number(p.bedrooms)) ? Number(p.bedrooms) : null,
    bathrooms: p.bathrooms != null && Number.isFinite(Number(p.bathrooms)) ? Number(p.bathrooms) : null,
    construction_m2:
      p.construction_m2 != null && Number.isFinite(Number(p.construction_m2)) ? Number(p.construction_m2) : null,
    terrain_m2: p.terrain_m2 != null && Number.isFinite(Number(p.terrain_m2)) ? Number(p.terrain_m2) : null,
    status: p.status || null,
  };
}

/**
 * Estructura estable para UI / ai_state (incluye raw).
 * @param {object|null} row
 * @returns {object|null}
 */
function normalizeInventoryProperty(row) {
  if (!row || !row.id) return null;
  const slug = stripSupabaseNoiseFromSlug(row.slug);
  const priceNum = pickNumericPrice(row);
  const currency = row.currency_code || row.currency || 'MXN';
  const public_url = buildPublicPropertyUrl({ ...row, slug });
  const opLabel = propertyOperationLabel(row);
  const location_label =
    cleanSpaces(String(row.neighborhood || row.zone || row.municipality || row.city || '')) || null;

  let price_label = null;
  if (priceNum != null) {
    try {
      price_label = formatMoney(priceNum, currency);
    } catch {
      price_label = String(priceNum);
    }
  }

  return {
    id: String(row.id),
    code: cleanSpaces(String(row.listing_id || row.public_code || row.code || '')) || null,
    slug: slug || null,
    title: row.title || null,
    operation_type: row.operation_type || row.operation || null,
    operation_label: opLabel,
    price: priceNum,
    price_label,
    currency,
    status: row.status || null,
    is_active: row.is_active != null ? !!row.is_active : null,
    is_published: row.published != null ? !!row.published : row.is_published != null ? !!row.is_published : null,
    visible_on_website: row.visible_on_website != null ? !!row.visible_on_website : null,
    zone: row.zone || null,
    neighborhood: row.neighborhood || null,
    municipality: row.municipality || null,
    city: row.city || null,
    location_label,
    property_type: row.property_type || null,
    property_category: row.property_category || null,
    bedrooms: row.bedrooms != null && Number.isFinite(Number(row.bedrooms)) ? Number(row.bedrooms) : null,
    bathrooms: row.bathrooms != null && Number.isFinite(Number(row.bathrooms)) ? Number(row.bathrooms) : null,
    construction_m2:
      row.construction_m2 != null && Number.isFinite(Number(row.construction_m2))
        ? Number(row.construction_m2)
        : null,
    terrain_m2: row.terrain_m2 != null && Number.isFinite(Number(row.terrain_m2)) ? Number(row.terrain_m2) : null,
    highlights: row.public_highlights ?? row.highlights ?? null,
    amenities: row.amenities ?? null,
    public_url,
    cover_image_url: row.cover_image_url || null,
    responsible_agent_profile_id: row.responsible_agent_profile_id || row.agent_profile_id || null,
    raw: row,
  };
}

async function selectPropertyRow(db, columns, applyFilter, logger) {
  if (!db || typeof db.from !== 'function') return { data: null, error: new Error('no_db') };
  try {
    let q = db.from('properties').select(columns);
    q = applyFilter(q);
    const { data, error } = await q.limit(1).maybeSingle();
    if (error) return { data: null, error };
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e };
  }
}

function columnMissingError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  return m.includes('column') || m.includes('schema') || m.includes('does not exist');
}

function errorMessageReferencesColumn(message, column) {
  const msg = String(message || '').toLowerCase();
  const c = String(column || '').toLowerCase();
  if (!msg || !c) return false;
  const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(properties\\.)?${escaped}\\b`).test(msg);
}

/**
 * Busca por columna opcional; si la columna no existe en la tabla, retorna null sin romper el flujo.
 */
async function findPropertyRowByEqColumn(db, column, value, logger) {
  if (!column || value == null || String(value).trim() === '') return null;
  const v = String(value).trim();
  let filterColumnMissing = false;
  for (let i = 0; i < SELECT_TIERS.length; i++) {
    const columns = SELECT_TIERS[i];
    const { data, error } = await selectPropertyRow(db, columns, (q) => q.eq(column, v), logger);
    if (!error && data?.id) return data;
    if (error && columnMissingError(error)) {
      if (errorMessageReferencesColumn(error.message, column)) {
        filterColumnMissing = true;
        logInventoryFallback(logger, 'column_or_schema_mismatch', { tier: i, column, message: error.message });
        break;
      }
      logInventoryFallback(logger, 'column_or_schema_mismatch', { tier: i, column, message: error.message });
      continue;
    }
    if (error && i < SELECT_TIERS.length - 1) {
      logInventoryFallback(logger, 'select_failed_retry', { tier: i, column, message: error.message });
    }
  }
  if (filterColumnMissing) return null;
  return null;
}

async function findPropertyRowWithTieredSelect(db, applyFilter, logger) {
  let lastErr = null;
  for (let i = 0; i < SELECT_TIERS.length; i++) {
    const columns = SELECT_TIERS[i];
    const { data, error } = await selectPropertyRow(db, columns, applyFilter, logger);
    if (!error && data?.id) return data;
    if (error) {
      lastErr = error;
      if (i < SELECT_TIERS.length - 1 && columnMissingError(error)) {
        logInventoryFallback(logger, 'column_or_schema_mismatch', { tier: i, message: error.message });
        continue;
      }
      if (i < SELECT_TIERS.length - 1) {
        logInventoryFallback(logger, 'select_failed_retry', { tier: i, message: error.message });
        continue;
      }
    }
  }
  return null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} db
 * @param {string} code — LUX-A0470 o variante
 */
async function findPropertyByCode(db, code, logger = console) {
  const normalized = normalizeInventoryCode(code) || cleanSpaces(String(code || ''));
  if (!normalized) return { property: null, propertyId: null, normalized: null };

  let row = await findPropertyRowWithTieredSelect(db, (q) => q.eq('listing_id', normalized), logger);
  if (!row && normalized.startsWith('LUX-')) {
    const alt = normalized.replace(/^LUX-/, '');
    row = await findPropertyRowWithTieredSelect(db, (q) => q.eq('listing_id', alt), logger);
  }
  if (!row && isUuidLike(normalized)) {
    row = await findPropertyRowWithTieredSelect(db, (q) => q.eq('id', normalized), logger);
  }

  if (!row) {
    row = await findPropertyRowByEqColumn(db, 'public_code', normalized, logger);
  }
  if (!row && normalized.startsWith('LUX-')) {
    row = await findPropertyRowByEqColumn(db, 'code', normalized, logger);
  }

  if (!row) return { property: null, propertyId: null, normalized: null };
  const normalizedShape = normalizeInventoryProperty(row);
  return { property: { ...row, ...normalizedShape, raw: row }, propertyId: row.id, normalized: normalizedShape };
}

async function findPropertyBySlug(db, slug, logger = console) {
  const s = stripSupabaseNoiseFromSlug(slug);
  if (!s) return { property: null, propertyId: null, normalized: null };
  const row = await findPropertyRowWithTieredSelect(db, (q) => q.eq('slug', s), logger);
  if (!row?.id) return { property: null, propertyId: null, normalized: null };
  const normalizedShape = normalizeInventoryProperty(row);
  return { property: { ...row, ...normalizedShape, raw: row }, propertyId: row.id, normalized: normalizedShape };
}

/**
 * Referencia flexible: código en texto, URL luxetty, slug; fallback título+zona acotado.
 */
async function findPropertyByLooseReference(db, text, opts = {}) {
  const logger = opts.logger || console;
  const hintZone = cleanSpaces(String(opts.hintZone || ''));

  const code = extractPropertyCode(text);
  if (code) {
    const r = await findPropertyByCode(db, code, logger);
    if (r.property) return r;
  }

  const t = String(text || '');
  const urlSlug = t.match(/luxetty\.com\/propiedad\/([a-z0-9-]+)/i);
  if (urlSlug?.[1]) {
    const r = await findPropertyBySlug(db, urlSlug[1], logger);
    if (r.property) return r;
  }

  const slugish = t.match(/\b([a-z]{3,}-en-[a-z0-9-]+(?:-en-venta|-en-renta)?)\b/i);
  if (slugish?.[1]) {
    const r = await findPropertyBySlug(db, slugish[1], logger);
    if (r.property) return r;
  }

  if (hintZone && /propiedad|casa|depa|depto|interesa/i.test(t)) {
    const row = await findPropertyRowWithTieredSelect(
      db,
      (q) => q.ilike('neighborhood', `%${hintZone}%`),
      logger
    );
    if (row?.id) {
      const z = normalizeText(String(row.neighborhood || row.city || row.municipality || row.zone || ''));
      const zn = normalizeText(hintZone);
      if (z && zn && (z.includes(zn) || zn.includes(z))) {
        const normalizedShape = normalizeInventoryProperty(row);
        return { property: { ...row, ...normalizedShape, raw: row }, propertyId: row.id, normalized: normalizedShape };
      }
    }
  }

  return { property: null, propertyId: null, normalized: null };
}

function extractZoneFromPropertyPhrase(text) {
  const m = String(text || '').match(/\bde\s+([^.?!\n]+?)(?:\s*$|\s*[.?!])/im);
  return m ? cleanSpaces(m[1]) : '';
}

/**
 * Punto de entrada webhook: código activo + texto usuario.
 */
async function findPropertyByInventoryReference(db, { code, text, hintZone } = {}, logger = console) {
  const c = cleanSpaces(String(code || ''));
  const zoneHint = cleanSpaces(String(hintZone || '')) || extractZoneFromPropertyPhrase(text || '');
  if (c) {
    const byCode = await findPropertyByCode(db, c, logger);
    if (byCode.property) return byCode;
  }
  if (text) {
    const loose = await findPropertyByLooseReference(db, text, { logger, hintZone: zoneHint });
    if (loose.property) return loose;
  }
  return { property: null, propertyId: null, normalized: null };
}

function prunePropertyContextByCode(byCode, history, max = 5) {
  const o = byCode && typeof byCode === 'object' ? { ...byCode } : {};
  const codes = Array.isArray(history) ? history.map((h) => h?.code).filter(Boolean) : [];
  const keep = new Set(codes.slice(0, max));
  for (const k of Object.keys(o)) {
    if (!keep.has(k)) delete o[k];
  }
  return o;
}

function pushPropertyHistory(prevState, { code, interested_property_id }) {
  const c = cleanSpaces(String(code || ''));
  if (!c) return {};
  const prevHist = Array.isArray(prevState.property_history) ? [...prevState.property_history] : [];
  const filtered = prevHist.filter((e) => cleanSpaces(String(e?.code || '')) !== c);
  filtered.unshift({
    code: c,
    interested_property_id: interested_property_id != null ? String(interested_property_id) : null,
    at: new Date().toISOString(),
  });
  const property_history = filtered.slice(0, 5);
  const byCode = { ...(prevState.property_context_by_code && typeof prevState.property_context_by_code === 'object' ? prevState.property_context_by_code : {}) };
  return {
    property_history,
    property_context_by_code: prunePropertyContextByCode(byCode, property_history, 5),
    current_property_code: c,
    current_interested_property_id: interested_property_id != null ? String(interested_property_id) : null,
  };
}

function mergePropertyContextCache(prevState, code, snapshot) {
  const c = cleanSpaces(String(code || ''));
  if (!c || !snapshot) return {};
  const byCode = { ...(prevState.property_context_by_code && typeof prevState.property_context_by_code === 'object' ? prevState.property_context_by_code : {}) };
  byCode[c] = snapshot;
  return {
    property_context_by_code: prunePropertyContextByCode(byCode, prevState.property_history || [], 5),
  };
}

module.exports = {
  normalizeInventoryCode,
  buildPublicPropertyUrl,
  getPropertyPublicFacts,
  normalizeInventoryProperty,
  findPropertyByCode,
  findPropertyBySlug,
  findPropertyByLooseReference,
  findPropertyByInventoryReference,
  propertyHasPublicLink,
  propertyHasPrice,
  propertyOperationLabel,
  pushPropertyHistory,
  mergePropertyContextCache,
  prunePropertyContextByCode,
  SELECT_TIERS,
  extractZoneFromPropertyPhrase,
};
