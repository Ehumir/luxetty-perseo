'use strict';

/**
 * PERSEO — Resolución de memoria conversacional operativa (demanda / zona / presupuesto).
 * Evita respuestas consultivas genéricas cuando ya hay contexto útil en ai_state.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const { formatPropertyTypeLabel } = require('../utils/formatting');
const { extractMaxPrice, extractBedrooms } = require('./parsers');
const r0ContextContinuity = require('./r0ContextContinuity');

const FORBIDDEN_GENERIC_SNIPPETS = [
  'claro, te ayudo. dime un poco mas de lo que buscas y te oriento',
  'dime un poco mas de lo que buscas y te oriento',
  'te apoyo con gusto. para orientarte sin inventar datos, dime en una frase que buscas',
];

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

function mergeUniqueStrings(a = [], b = []) {
  return Array.from(
    new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].map((s) => String(s || '').trim()).filter(Boolean))
  );
}

function parseMdpBudget(text) {
  const t = normalizeText(text);
  const m = t.match(/\b(\d+(?:[.,]\d+)?)\s*mdp\b/);
  if (!m?.[1]) return null;
  const value = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1_000_000);
}

function parseBedroomsFromCuartos(text) {
  const t = normalizeText(text);
  const m = t.match(/(\d+)\s*(cuartos?|habitaciones?|recamaras?|recámaras?)/i);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 20 ? n : null;
}

function parseFeatureTokens(text) {
  const t = normalizeText(text);
  const out = [];
  if (/\bpatio\b/.test(t) && !/\bsin patio\b/.test(t)) out.push('patio');
  if (/\balberca\b/.test(t) || /\bpiscina\b/.test(t)) out.push('alberca');
  return out;
}

function isOptionsRequestText(text) {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    t.includes('dame opciones') ||
    t.includes('dame opcion') ||
    t.includes('dame opción') ||
    t.includes('pasame opciones') ||
    t.includes('pásame opciones') ||
    t.includes('tienes opciones') ||
    t.includes('hay opciones') ||
    t.includes('opciones disponibles') ||
    t.includes('que opciones') ||
    t.includes('qué opciones') ||
    (t.includes('opciones') && t.includes('?'))
  );
}

function replyDemandsUnknownBudgetOrZone(replyText, aiState = {}) {
  const rt = normalizeText(String(replyText || ''));
  const st = aiState && typeof aiState === 'object' ? aiState : {};
  const hasBudget = st.budget_max != null && Number.isFinite(Number(st.budget_max));
  const hasLoc = !!cleanSpaces(String(st.location_text || ''));
  const hasBedrooms = st.bedrooms != null && Number.isFinite(Number(st.bedrooms));

  if (hasBudget && (rt.includes('presupuesto aproximado') || rt.includes('cual es tu presupuesto'))) return true;
  if (hasBudget && rt.includes('dime tambien tu presupuesto')) return true;
  if (hasLoc && hasBudget && rt.includes('te ayudo a buscar casa en') && rt.includes('presupuesto')) return true;
  if (hasLoc && hasBudget && hasBedrooms && rt.includes('recamaras') && rt.includes('filtrar por recamaras'))
    return false;
  if (hasLoc && rt.includes('en que zona') && rt.includes('propiedad')) return true;

  return false;
}

function isCheaperRequest(text) {
  const t = normalizeText(text);
  return t.includes('mas barato') || t.includes('más barato') || t.includes('algo mas economico') || t.includes('algo más económico');
}

function isAnotherOptionRequest(text) {
  const t = normalizeText(text);
  return t.includes('otra opcion') || t.includes('otra opción') || t.includes('alguna otra') || t.includes('ver otra');
}

function usesSavedZonePhrase(text) {
  const t = normalizeText(text);
  return t.includes('en esa zona') || t.includes('esa zona') || t.includes('misma zona');
}

function usesSavedBudgetPhrase(text) {
  const t = normalizeText(text);
  return t.includes('con ese presupuesto') || t.includes('ese presupuesto') || t.includes('mismo presupuesto');
}

/**
 * @returns {{ type: string|null, detail?: object }}
 */
function resolveContextualFollowUp(text, aiState = {}, recentMessages = []) {
  const t = normalizeText(text);
  const st = aiState && typeof aiState === 'object' ? aiState : {};
  if (!t) return { type: null };

  if (isOptionsRequestText(text) && hasOperationalContext(st)) {
    return { type: 'options_request', detail: { recentCount: Array.isArray(recentMessages) ? recentMessages.length : 0 } };
  }

  if (st.lead_flow === 'demand' && st.location_text && (extractMaxPrice(text) != null || parseMdpBudget(text) != null)) {
    return { type: 'budget_followup', detail: {} };
  }

  if (st.lead_flow === 'demand' && (parseBedroomsFromCuartos(text) != null || extractBedrooms(text) != null)) {
    return { type: 'bedrooms_followup', detail: {} };
  }

  if (usesSavedZonePhrase(text) && st.location_text) {
    return { type: 'zone_reference', detail: { location_text: st.location_text } };
  }

  if (usesSavedBudgetPhrase(text) && st.budget_max != null) {
    return { type: 'budget_reference', detail: { budget_max: st.budget_max } };
  }

  if (parseFeatureTokens(text).length) {
    return { type: 'feature_followup', detail: { features: parseFeatureTokens(text) } };
  }

  if (isCheaperRequest(text) && st.budget_max != null) {
    return { type: 'budget_downshift', detail: {} };
  }

  if (isAnotherOptionRequest(text) && hasOperationalContext(st)) {
    return { type: 'more_results', detail: {} };
  }

  return { type: null };
}

function hasOperationalContext(aiState = {}) {
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  if (s.lead_flow) return true;
  if (cleanSpaces(String(s.location_text || ''))) return true;
  if (s.budget_max != null && Number.isFinite(Number(s.budget_max))) return true;
  if (cleanSpaces(String(s.property_code || s.direct_property_code || ''))) return true;
  if (s.operation_type) return true;
  if (s.bedrooms != null && Number.isFinite(Number(s.bedrooms))) return true;
  if (Array.isArray(s.must_have_features) && s.must_have_features.length > 0) return true;
  return false;
}

function isGenericConsultiveReply(replyText) {
  const t = normalizeText(String(replyText || ''));
  if (!t) return true;
  for (const snip of FORBIDDEN_GENERIC_SNIPPETS) {
    if (t.includes(snip)) return true;
  }
  if (t === 'hola, claro. te puedo ayudar. dime en una frase que necesitas y lo revisamos.') return true;
  return false;
}

/**
 * Prohibido caer en plantilla genérica si ya hay señal operativa o follow-up contextual.
 */
function isGenericFallbackForbidden(aiState = {}, text = '') {
  const st = aiState && typeof aiState === 'object' ? aiState : {};
  if (hasOperationalContext(st)) return true;
  const fu = resolveContextualFollowUp(text, st, []);
  if (fu && fu.type) return true;
  if (isOptionsRequestText(text) && (st.location_text || st.budget_max != null)) return true;
  return false;
}

/**
 * Fusiona señales de cortesía / follow-up que el parser principal puede no reflejar en ai_state.
 * @param {object} parsedSignals
 * @param {object} previousAiState estado antes del turno (para frases "en esa zona" / "ese presupuesto").
 * @param {object} nextAiState estado tras buildNextState (puede traer location errónea del parser).
 * @param {string} text
 * @returns {object} parche plano para Object.assign sobre nextAiState
 */
function mergeContextualSignals(parsedSignals = {}, previousAiState = {}, nextAiState = {}, text = '') {
  const patch = {};
  const prevSnap = previousAiState && typeof previousAiState === 'object' ? previousAiState : {};
  const built = nextAiState && typeof nextAiState === 'object' ? nextAiState : {};
  const sig = parsedSignals && typeof parsedSignals === 'object' ? parsedSignals : {};
  const raw = cleanSpaces(String(text || ''));
  const t = normalizeText(raw);

  const propertyCodeCtx = cleanSpaces(
    String(prevSnap.property_code || built.property_code || sig.property_code || prevSnap.direct_property_code || '')
  );
  const propertyMode =
    !!propertyCodeCtx &&
    (prevSnap.property_specific_intent ||
      built.property_specific_intent ||
      sig.property_specific_intent ||
      prevSnap.direct_property_reference ||
      built.direct_property_reference ||
      sig.direct_property_reference);

  const demandish =
    prevSnap.lead_flow === 'demand' || built.lead_flow === 'demand' || sig.lead_flow === 'demand';
  const hasLoc = !!cleanSpaces(String(prevSnap.location_text || built.location_text || sig.location_text || ''));
  const offerCapture =
    r0ContextContinuity.isR0StickySaleCaptureThread(prevSnap) ||
    built.lead_flow === 'offer' ||
    sig.lead_flow === 'offer';

  let budget =
    sig.budget_max != null && Number.isFinite(Number(sig.budget_max)) ? Number(sig.budget_max) : null;
  if (!propertyMode && budget == null && demandish && hasLoc && !offerCapture) {
    budget = extractMaxPrice(raw);
    if (budget == null) budget = parseMdpBudget(raw);
  }
  if (budget != null && Number.isFinite(budget) && !offerCapture) {
    patch.budget_max = budget;
    patch.budget_currency = sig.budget_currency || built.budget_currency || prevSnap.budget_currency || 'MXN';
    patch.lead_flow = built.lead_flow || prevSnap.lead_flow || sig.lead_flow || 'demand';
  }

  let bedrooms = sig.bedrooms != null && Number.isFinite(Number(sig.bedrooms)) ? Number(sig.bedrooms) : null;
  if (!propertyMode && bedrooms == null) {
    bedrooms = extractBedrooms(raw);
    if (bedrooms == null) bedrooms = parseBedroomsFromCuartos(raw);
  }
  if (bedrooms != null && Number.isFinite(bedrooms) && (demandish || hasLoc)) {
    patch.bedrooms = bedrooms;
    patch.lead_flow = built.lead_flow || prevSnap.lead_flow || sig.lead_flow || 'demand';
  }

  const feats = parseFeatureTokens(raw);
  if (feats.length && demandish && !propertyMode) {
    patch.must_have_features = mergeUniqueStrings(built.must_have_features, feats);
    patch.lead_flow = built.lead_flow || prevSnap.lead_flow || sig.lead_flow || 'demand';
  }

  if (usesSavedZonePhrase(raw) && cleanSpaces(String(prevSnap.location_text || ''))) {
    patch.location_text = cleanSpaces(String(prevSnap.location_text));
    patch.lead_flow = built.lead_flow || prevSnap.lead_flow || 'demand';
  }

  if (usesSavedBudgetPhrase(raw) && prevSnap.budget_max != null && Number.isFinite(Number(prevSnap.budget_max)) && !offerCapture) {
    patch.budget_max = Number(prevSnap.budget_max);
    patch.budget_currency = prevSnap.budget_currency || built.budget_currency || 'MXN';
  }

  const baseBudget =
    built.budget_max != null && Number.isFinite(Number(built.budget_max)) ? Number(built.budget_max) : null;
  const prevBudget =
    prevSnap.budget_max != null && Number.isFinite(Number(prevSnap.budget_max)) ? Number(prevSnap.budget_max) : null;

  if (!propertyMode && isCheaperRequest(raw) && (baseBudget != null || prevBudget != null)) {
    const ref = baseBudget ?? prevBudget;
    const pct = /\b(\d{1,2})\s*%/.test(t) ? Number(t.match(/\b(\d{1,2})\s*%/)?.[1]) : null;
    const factor = pct != null && pct > 0 && pct < 80 ? 1 - pct / 100 : 0.85;
    patch.budget_max = Math.max(100000, Math.round(ref * factor));
    patch.needs_fresh_search = true;
  }

  if (!propertyMode && isAnotherOptionRequest(raw)) {
    patch.needs_fresh_search = true;
  }

  if (!propertyMode && isOptionsRequestText(raw)) {
    patch.needs_fresh_search = true;
  }

  const preserveKeys = ['budget_max', 'location_text', 'bedrooms', 'lead_flow', 'full_name', 'operation_type'];
  for (const k of preserveKeys) {
    if (patch[k] === null || patch[k] === undefined) delete patch[k];
  }

  return patch;
}

function propertyLines(matched = [], max = 3) {
  const list = Array.isArray(matched) ? matched : [];
  const lines = [];
  const cap = Math.min(max, 3, list.length);
  for (let i = 0; i < cap; i += 1) {
    const p = list[i] || {};
    const code = cleanSpaces(String(p.listing_id || p.property_code || ''));
    if (!code) continue;
    lines.push(`• Referencia interna ${code} (sin inventar precio ni disponibilidad aquí).`);
  }
  return lines;
}

/**
 * P0.1.1 — Captación/venta: no usar plantillas de demanda/búsqueda.
 * P0.1.2 — Misma heurística que sticky R0 (no confundir comprador demand+sale con vendedor).
 */
function isOfferOrSellerSaleContext(aiState = {}) {
  return r0ContextContinuity.isR0StickySaleCaptureThread(aiState);
}

/**
 * Sustitución contextual para oferta/venta (sin lenguaje de comprador ni “búsqueda”).
 */
function buildContextualOfferCaptureReply(context = {}) {
  const {
    aiState = {},
    text = '',
    hasValidName = false,
    propertyTypeLabel = 'casa',
  } = context;
  const st = aiState && typeof aiState === 'object' ? aiState : {};
  const loc = cleanSpaces(String(st.location_text || ''));
  const t = normalizeText(String(text || ''));
  const typeLabel = propertyTypeLabel && propertyTypeLabel !== 'null' ? propertyTypeLabel : 'propiedad';
  const wantsOptions = isOptionsRequestText(text);
  const priceOrValueMention = t.includes('precio') || t.includes('cuesta') || t.includes('valu');
  const { isSaleProcessQuestion } = require('./r0ContextContinuity');

  if (isSaleProcessQuestion(text)) {
    const tail = hasValidName
      ? ' ¿Te gustaría que un asesor te contacte para revisar tu propiedad?'
      : ' Para orientarte bien, ¿me compartes tu nombre?';
    const z = loc ? ` en ${loc}` : '';
    return `El proceso de venta con Luxetty empieza con una prevaluación comercial sin costo: revisamos tu propiedad${z}, te orientamos sobre estrategia y, si te interesa, un asesor te acompaña en publicación y negociación.${tail}`.trim();
  }

  if (wantsOptions && loc) {
    return `En captación/venta no manejo un listado de opciones para comprar como en una búsqueda de comprador. Sí puedo ayudarte a ordenar tu ${typeLabel} en ${loc} y canalizar a un asesor para estrategia y valuación sin prometer inventario. ¿Prefieres partir de motivación de venta o de datos del inmueble?`;
  }

  if (!loc) {
    const tail = hasValidName ? '' : ' Antes de avanzar, ¿cómo te llamas?';
    return `Para orientarte con la venta de tu ${typeLabel}, dime en qué colonia o municipio está.${tail}`.trim();
  }

  if (priceOrValueMention) {
    const tail = hasValidName ? '' : ' Antes de seguir, ¿cómo te llamas?';
    return `Con la venta en ${loc}, puedo orientarte sobre rango esperado o valuación a alto nivel sin inventar datos de mercado aquí.${tail}`.trim();
  }

  const tail = hasValidName ? '' : ' Antes de seguir, ¿cómo te llamas?';
  return `Sigo con la venta de tu ${typeLabel} en ${loc}. Si quieres, dime tipo de inmueble y en qué etapa va (habitada, rentada o libre).${tail}`.trim();
}

/**
 * Respuesta mínima alineada a demanda con contexto; nunca inventa inventario.
 */
function buildContextualDemandReply(context = {}) {
  const {
    aiState = {},
    text = '',
    hasValidName = false,
    matchedProperties = [],
    propertyTypeLabel = 'casa',
  } = context;

  const st = aiState && typeof aiState === 'object' ? aiState : {};
  if (isOfferOrSellerSaleContext(st)) return null;
  const loc = cleanSpaces(String(st.location_text || ''));
  const budget = st.budget_max != null && Number.isFinite(Number(st.budget_max)) ? Number(st.budget_max) : null;
  const bLabel = budget != null ? formatMoneyMx(budget) : null;
  const br = st.bedrooms != null && Number.isFinite(Number(st.bedrooms)) ? Number(st.bedrooms) : null;
  const feats = Array.isArray(st.must_have_features) ? st.must_have_features.filter(Boolean) : [];
  const featStr = feats.length ? feats.join(', ') : null;
  const wantsOptions = isOptionsRequestText(text);
  const props = Array.isArray(matchedProperties) ? matchedProperties : [];

  const honestNoInventory = () => {
    const zone = loc || 'esa zona';
    const pres = bLabel || 'tu presupuesto';
    return `En este momento no quiero inventarte propiedades. Puedo canalizarte con un asesor para validar inventario actualizado en ${zone} con presupuesto de ${pres}.`;
  };

  if (props.length) {
    const head = hasValidName
      ? `Encontré estas referencias reales en sistema (máximo 3), sin inventar precios ni ligas:`
      : `Tengo algunas referencias reales en sistema (máximo 3), sin inventar precios ni ligas:`;
    const body = propertyLines(props, 3).join('\n');
    const tail = hasValidName
      ? '\n\n¿Quieres que un asesor confirme disponibilidad y detalles contigo?'
      : '\n\nPara registrarte bien, ¿me compartes tu nombre?';
    return [head, body, tail].filter(Boolean).join('\n');
  }

  if (wantsOptions && loc && budget != null && br != null) {
    const base = `Con ${bLabel} en ${loc} y ${br} recámaras puedo revisar opciones reales alineadas a lo que buscas. ¿Quieres que te comparta opciones disponibles o prefieres que un asesor valide inventario actualizado contigo?`;
    if (!hasValidName) return `${base}\n\nPara registrarte bien, ¿me compartes tu nombre?`;
    return base;
  }

  if (wantsOptions && loc && budget != null) {
    const base = `Con ${bLabel} en ${loc} puedo revisar opciones reales alineadas a lo que buscas. ¿Quieres que te comparta opciones disponibles o prefieres que un asesor valide inventario actualizado contigo?`;
    if (!hasValidName) return `${base}\n\nPara registrarte bien, ¿me compartes tu nombre?`;
    return base;
  }

  if (wantsOptions && (loc || budget != null)) {
    if (!hasValidName) {
      return `${honestNoInventory()}\n\nPara registrarte bien, ¿me compartes tu nombre?`;
    }
    return `${honestNoInventory()}\n\n¿Prefieres que te comparta opciones disponibles cuando el inventario esté confirmado, o que un asesor lo valide contigo ahora?`;
  }

  if (loc && budget != null && br != null) {
    const intro = `Perfecto, busco ${propertyTypeLabel} en ${loc}, alrededor de ${bLabel} y con ${br} recámaras. Voy a revisar opciones reales para no inventarte inventario.`;
    const ask = hasValidName
      ? '¿Prefieres que te comparta opciones disponibles o que un asesor lo valide contigo?'
      : 'Para registrarte bien, ¿me compartes tu nombre?';
    return `${intro} ${ask}`;
  }

  if (loc && budget != null) {
    const filters = featStr
      ? ` Si quieres, también puedo filtrar por ${featStr}, privada o zona específica dentro de ${loc}.`
      : ` Si quieres, también puedo filtrar por recámaras, patio, privada o zona específica dentro de ${loc}.`;
    const core = `Con ${bLabel} en ${loc} puedo revisar opciones reales alineadas a lo que buscas.${filters}`;
    const ask = hasValidName
      ? '¿Quieres que te comparta opciones disponibles o prefieres que un asesor valide inventario actualizado contigo?'
      : 'Para registrarte bien, ¿me compartes tu nombre?';
    return `${core} ${ask}`.replace(/\s+/g, ' ').trim();
  }

  if (loc && !budget) {
    return hasValidName
      ? `Sigo con tu búsqueda en ${loc}. ¿Me confirmas tu presupuesto aproximado para afinar opciones reales?`
      : `Sigo con tu búsqueda en ${loc}. Para registrarte bien, ¿me compartes tu nombre? Y dime también tu presupuesto aproximado.`;
  }

  return hasValidName
    ? 'Con lo que ya me compartiste puedo seguir afinando la búsqueda con datos reales. ¿Quieres ajustar zona, presupuesto o recámaras?'
    : 'Con lo que ya me compartiste puedo seguir afinando la búsqueda con datos reales. Para registrarte bien, ¿me compartes tu nombre?';
}

/**
 * Si el mensaje de salida es plantilla genérica y el contexto lo prohíbe, sustituye por respuesta contextual.
 */
function substituteForbiddenGenericDemandReply(messages, context = {}) {
  const {
    aiState = {},
    text = '',
    hasValidName = false,
    matchedProperties = [],
    recentMessages = [],
    contact = null,
    waProfileName = null,
  } = context;
  const merged = Array.isArray(messages) ? messages.map((s) => String(s || '').trim()).filter(Boolean).join('\n\n') : String(messages || '');
  const forbiddenCtx = isGenericFallbackForbidden(aiState, text);
  const bad = isGenericConsultiveReply(merged);

  const redundant = replyDemandsUnknownBudgetOrZone(merged, aiState);

  const propertyIntentResolver = require('./propertyIntentResolver');
  if (propertyIntentResolver.isPropertySpecificConversation(aiState) && forbiddenCtx && (bad || redundant)) {
    const row = Object.prototype.hasOwnProperty.call(context, 'resolvedPropertyRow') ? context.resolvedPropertyRow : null;
    const reply = propertyIntentResolver.buildPropertyModeReply({
      text,
      aiState,
      propertyRow: row,
      hasValidName,
      recentMessages,
      contact,
      waProfileName,
    });
    return { messages: reply, statePatch: {} };
  }

  if (!forbiddenCtx || (!bad && !redundant)) {
    return { messages, statePatch: {} };
  }

  const ptype = cleanSpaces(String(aiState.property_type || ''));
  const propertyTypeLabel = formatPropertyTypeLabel(ptype);

  const reply = isOfferOrSellerSaleContext(aiState)
    ? buildContextualOfferCaptureReply({
        aiState,
        text,
        hasValidName,
        propertyTypeLabel,
      })
    : buildContextualDemandReply({
        aiState,
        text,
        hasValidName,
        matchedProperties,
        propertyTypeLabel,
      });

  if (!cleanSpaces(String(reply || ''))) {
    return { messages, statePatch: {} };
  }

  const statePatch = {};
  const shown = (Array.isArray(matchedProperties) ? matchedProperties : []).slice(0, 3);
  const ids = shown.map((p) => p?.id).filter(Boolean);
  if (ids.length && Array.isArray(aiState.last_shown_property_ids)) {
    statePatch.last_shown_property_ids = mergeUniqueStrings(aiState.last_shown_property_ids, ids.map(String));
  } else if (ids.length) {
    statePatch.last_shown_property_ids = ids.map(String);
  }

  return { messages: reply, statePatch };
}

module.exports = {
  resolveContextualFollowUp,
  hasOperationalContext,
  isGenericFallbackForbidden,
  isGenericConsultiveReply,
  isOfferOrSellerSaleContext,
  buildContextualOfferCaptureReply,
  buildContextualDemandReply,
  mergeContextualSignals,
  substituteForbiddenGenericDemandReply,
  formatMoneyMx,
  isOptionsRequestText,
  replyDemandsUnknownBudgetOrZone,
};
