'use strict';

const { normalizeText, cleanSpaces } = require('../utils/text');
const { formatMoney, formatPropertyTypeLabel } = require('../utils/formatting');
const { hasValidHumanName } = require('./namePrompt');
const {
  extractPropertyCode,
  isPropertySpecificConversation,
  pickNumericPrice,
} = require('./propertyIntentResolver');

const GENERIC_CTA_PHRASE = '¿te gustaría que te comparta detalles, precio, ubicación o agendar una visita?';

function getDisplayCode(property, aiState) {
  return cleanSpaces(
    String(property?.listing_id || aiState?.property_code || aiState?.direct_property_code || '')
  );
}

function buildPublicPropertyUrl(property = {}) {
  const slug = typeof property.slug === 'string' ? property.slug.trim() : '';
  if (!slug || /\s/.test(slug)) return null;
  const cleanSlug = slug
    .replace(/^https?:\/\/(?:www\.)?luxetty\.com\/propiedad\//i, '')
    .replace(/^\/?propiedad\//i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!cleanSlug || /\s/.test(cleanSlug)) return null;
  return `https://luxetty.com/propiedad/${cleanSlug}`;
}

function getZoneLabel(property = {}, aiState = {}) {
  return cleanSpaces(
    String(
      property.neighborhood ||
        property.zone ||
        property.municipality ||
        property.city ||
        aiState.location_text ||
        ''
    )
  );
}

function firstNameFromFull(fullName) {
  const p = cleanSpaces(String(fullName || ''));
  if (!p) return null;
  return p.split(/\s+/)[0] || p;
}

function outboundContainsGenericCta(recentMessages = []) {
  const list = Array.isArray(recentMessages) ? recentMessages : [];
  const tail = list.slice(-6);
  for (const m of tail) {
    if (m?.direction !== 'outbound') continue;
    const body = normalizeText(String(m?.message_text || ''));
    if (body.includes(normalizeText(GENERIC_CTA_PHRASE))) return true;
  }
  return false;
}

/**
 * Evita repetir el CTA genérico exacto para el mismo código.
 */
function shouldAvoidRepeatedPropertyCTA(aiState = {}, recentMessages = []) {
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  const code = cleanSpaces(String(s.property_code || s.direct_property_code || ''));
  if (!code) return false;
  if (s.property_generic_cta_shown_for_code && cleanSpaces(String(s.property_generic_cta_shown_for_code)) === code) {
    return true;
  }
  return outboundContainsGenericCta(recentMessages);
}

/**
 * Parche de estado tras emitir respuesta de flujo por propiedad.
 * @param {object} aiState
 * @param {{ intentType: string, replyText?: string }} meta
 * @returns {object}
 */
function markPropertyReplyProgress(aiState, meta = {}) {
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  const code = cleanSpaces(String(s.property_code || s.direct_property_code || ''));
  const { intentType = null, replyText = '' } = meta;
  const patch = {};

  if (intentType) patch.property_last_follow_up_intent = intentType;

  const lowered = normalizeText(String(replyText || ''));
  if (lowered.includes(normalizeText(GENERIC_CTA_PHRASE)) && code) {
    patch.property_generic_cta_shown_for_code = code;
  }

  if (intentType === 'property_intro' && code) {
    patch.property_intro_shown_for_code = code;
  }

  if (intentType === 'frustration_recovery') {
    patch.property_pending_user_question = null;
  } else if (
    ['ask_price', 'ask_availability', 'ask_details', 'ask_location', 'ask_visit', 'ask_photos'].includes(intentType)
  ) {
    patch.property_pending_user_question = String(intentType).replace(/^ask_/, '');
  }

  return patch;
}

function isFrustration(t) {
  return (
    t.includes('no me estas entendiendo') ||
    t.includes('no me estás entendiendo') ||
    t.includes('no estas entendiendo') ||
    t.includes('no estás entendiendo') ||
    t.includes('no entiendes') ||
    t.includes('no me entiendes') ||
    t.includes('te pregunte') ||
    t.includes('te pregunté') ||
    t.includes('me ignoras') ||
    t.includes('no sirves')
  );
}

function isPhotosIntent(t) {
  return (
    t.includes('fotos') ||
    t.includes('foto') ||
    t.includes('imagenes') ||
    t.includes('imágenes') ||
    t.includes('mandame fotos') ||
    t.includes('mándame fotos')
  );
}

function isVisitIntent(t) {
  return (
    t.includes('quiero verla') ||
    t.includes('quiero verlo') ||
    t.includes('quiero ver la propiedad') ||
    t.includes('quiero visitar') ||
    t.includes('agendar visita') ||
    t.includes('agendar una visita') ||
    t.includes('verla mañana') ||
    t.includes('verla manana') ||
    t.includes('puedo verla') ||
    (t.includes('visita') && (t.includes('quiero') || t.includes('agendar')))
  );
}

function isAvailabilityIntent(t) {
  return t.includes('disponible') || t.includes('disponibilidad');
}

function isPriceIntent(t) {
  return (
    t.includes('precio') ||
    t.includes('cuesta') ||
    t.includes('cuanto') ||
    t.includes('cuánto') ||
    t.includes('valor') ||
    t.includes('cuanto sale') ||
    t.includes('cuánto sale')
  );
}

function isLocationIntent(t) {
  return (
    t.includes('donde esta') ||
    t.includes('dónde está') ||
    t.includes('donde queda') ||
    t.includes('ubicacion') ||
    t.includes('ubicación') ||
    t.includes('direccion') ||
    t.includes('dirección') ||
    (t.includes('zona') && !t.includes('precio'))
  );
}

function isDetailsIntent(t) {
  return (
    t.includes('detalles') ||
    t.includes('mas informacion') ||
    t.includes('más información') ||
    t.includes('informacion de la casa') ||
    t.includes('información de la casa') ||
    t.includes('ficha') ||
    t.includes('caracteristicas') ||
    t.includes('características') ||
    (t.includes('dame') && t.includes('informacion')) ||
    (t.includes('dame') && t.includes('información'))
  );
}

function wantsInitialPropertyIntro(t, extracted, aiState) {
  const code = cleanSpaces(String(aiState.property_code || aiState.direct_property_code || extracted || ''));
  if (!code) return false;
  if (aiState.property_intro_shown_for_code && cleanSpaces(String(aiState.property_intro_shown_for_code)) === code) {
    return false;
  }
  const interest =
    t.includes('me interesa') ||
    t.includes('interesa la propiedad') ||
    t.includes('interesa la casa') ||
    t.includes('me interesa la propiedad') ||
    (t.includes('hola') && (t.includes('propiedad') || !!extracted)) ||
    (t.includes('quiero') && t.includes('propiedad'));
  return !!(extracted || interest);
}

/**
 * @param {string} text
 * @param {object} aiState
 * @param {object[]} recentMessages
 * @returns {{ type: string|null, detail?: object }}
 */
function classifyPropertyFollowUp(text, aiState = {}, recentMessages = []) {
  if (!isPropertySpecificConversation(aiState)) return { type: null };
  const t = normalizeText(text);
  if (!t) return { type: null };

  const extracted = extractPropertyCode(text);
  const code = cleanSpaces(String(aiState.property_code || aiState.direct_property_code || ''));

  if (isFrustration(t)) return { type: 'frustration_recovery' };
  if (isPhotosIntent(t)) return { type: 'ask_photos' };
  if (isVisitIntent(t)) return { type: 'ask_visit' };
  if (isAvailabilityIntent(t)) return { type: 'ask_availability' };
  if (isPriceIntent(t)) return { type: 'ask_price' };
  if (isLocationIntent(t)) return { type: 'ask_location' };
  if (isDetailsIntent(t)) return { type: 'ask_details' };

  if (wantsInitialPropertyIntro(t, extracted, aiState)) {
    return { type: 'property_intro' };
  }

  if ((t.includes('me interesa') || t.includes('si me interesa') || t.includes('sí me interesa')) && code) {
    return { type: 'continue_property_interest' };
  }

  return { type: 'property_follow_up_generic' };
}

function nameTail(hasName, waProfileName, aiState = {}) {
  if (hasName) return '';
  if (aiState.awaiting_field === 'full_name') {
    return ' Cuando puedas, compárteme solo tu nombre y con eso lo registro bien.';
  }
  return ' Para registrarte bien, ¿me compartes tu nombre?';
}

function advisorTail(hasName) {
  if (hasName) {
    return ' Si me autorizas, un asesor de Luxetty puede contactarte para confirmar datos al día y visita.';
  }
  return '';
}

function buildPropertyIntroReply({ property, aiState = {}, contact = null, waProfileName = null }) {
  const hasName = hasValidHumanName(contact, aiState);
  const code = getDisplayCode(property, aiState);
  const zone = getZoneLabel(property, aiState);
  const zonePhrase = zone ? ` en ${zone}` : '';
  const url = property && property.id ? buildPublicPropertyUrl(property) : null;

  if (!property || !property.id) {
    return `No encontré una propiedad activa con el código ${code || 'indicado'}. Si quieres, puedo ayudarte a revisar otras opciones similares.${nameTail(hasName, waProfileName, aiState)}`;
  }

  if (url) {
    return `Claro, con gusto. Ya ubiqué la propiedad ${code}${zonePhrase}. Te comparto la liga para que puedas revisarla con calma:

${url}

También puedo ayudarte a confirmar precio, disponibilidad o una visita.${nameTail(hasName, waProfileName, aiState)}`.trim();
  }

  return `Claro, con gusto. Ya ubiqué la propiedad ${code}${zonePhrase}. En este momento no tengo un enlace público verificado para compartirte aquí; un asesor de Luxetty puede enviarte la ficha correcta.${advisorTail(hasName)}${nameTail(hasName, waProfileName, aiState)}`.trim();
}

function buildPropertyDetailsReply({ property, aiState = {}, contact = null, waProfileName = null }) {
  const hasName = hasValidHumanName(contact, aiState);
  const snap = aiState.property_context && typeof aiState.property_context === 'object' ? aiState.property_context : {};
  const row = property && property.id ? { ...snap, ...property } : null;
  const code = getDisplayCode(row || property || {}, aiState);
  const fn = firstNameFromFull(aiState.full_name);
  const prefix = fn ? `Claro, ${fn}. ` : 'Claro. ';
  const url = row && row.id ? buildPublicPropertyUrl(row) : null;
  const zone = getZoneLabel(row || {}, aiState);

  if (!row || !row.id) {
    return `${prefix}Sobre ${code || 'esa referencia'}, no tengo una ficha activa en sistema desde esta conversación.${nameTail(hasName, waProfileName, aiState)}`;
  }

  const parts = [];
  const title = cleanSpaces(String(row.title || ''));
  if (title) parts.push(`Título: ${title}.`);
  if (zone) parts.push(`Ubicación: ${zone}.`);
  const op = row.operation_type === 'rent' ? 'en renta' : row.operation_type === 'sale' ? 'en venta' : null;
  if (op) parts.push(`Operación: ${op}.`);
  if (row.property_type) {
    try {
      parts.push(`Tipo: ${formatPropertyTypeLabel(row.property_type)}.`);
    } catch {
      parts.push(`Tipo: ${row.property_type}.`);
    }
  }
  const p = pickNumericPrice(row);
  if (p != null) parts.push(`Precio en sistema: ${formatMoney(p, row.currency_code || 'MXN')}.`);
  if (row.bedrooms != null && Number.isFinite(Number(row.bedrooms))) parts.push(`Recámaras: ${row.bedrooms}.`);
  if (row.bathrooms != null && Number.isFinite(Number(row.bathrooms))) parts.push(`Baños: ${row.bathrooms}.`);
  if (row.terrain_m2 != null && Number.isFinite(Number(row.terrain_m2))) parts.push(`Terreno: ${row.terrain_m2} m².`);
  if (row.construction_m2 != null && Number.isFinite(Number(row.construction_m2))) {
    parts.push(`Construcción: ${row.construction_m2} m².`);
  }
  const hl = row.highlights;
  if (hl) {
    const hlStr = Array.isArray(hl) ? hl.filter(Boolean).map((x) => String(x).trim()).filter(Boolean).join('; ') : String(hl).trim();
    if (hlStr) parts.push(`Destacados: ${hlStr}.`);
  }
  const am = row.amenities;
  if (am) {
    const amStr = Array.isArray(am) ? am.filter(Boolean).map((x) => String(x).trim()).filter(Boolean).join('; ') : String(am).trim();
    if (amStr) parts.push(`Amenidades: ${amStr}.`);
  }

  const detailBlock = parts.length ? ` ${parts.join(' ')}` : ' No tengo más campos numéricos verificados en esta conversación.';
  const linkLine = url
    ? ` Aquí tienes la ficha para revisar fotos y descripción:

${url}`
    : ' Puedo pedir que un asesor te comparta la ficha con fotos y descripción.';

  return `${prefix}De la propiedad ${code} te puedo confirmar lo siguiente con datos que veo en sistema:${detailBlock}${linkLine}

Si quieres, puedo pedir que un asesor te confirme precio actualizado y disponibilidad para visita.${nameTail(hasName, waProfileName, aiState)}`.trim();
}

function buildPropertyPriceReply({ property, aiState = {}, contact = null, waProfileName = null }) {
  const hasName = hasValidHumanName(contact, aiState);
  const code = getDisplayCode(property, aiState);
  const p = property && property.id ? pickNumericPrice(property) : null;

  if (!property || !property.id) {
    return `Sobre ${code || 'esa referencia'}, no tengo una propiedad activa verificada en sistema.${nameTail(hasName, waProfileName, aiState)}`;
  }

  if (p != null) {
    const formatted = formatMoney(p, property.currency_code || 'MXN');
    return `El precio registrado de ${code} es de ${formatted}. Te recomiendo confirmarlo con un asesor porque puede cambiar según disponibilidad o actualización del inventario.${nameTail(hasName, waProfileName, aiState)}`;
  }

  return `Sobre ${code}, no tengo un precio numérico verificado en esta conversación. Puedo canalizarte con un asesor para confirmarlo con inventario actualizado.${nameTail(hasName, waProfileName, aiState)}`;
}

function buildPropertyAvailabilityReply({ property, aiState = {}, contact = null, waProfileName = null }) {
  const hasName = hasValidHumanName(contact, aiState);
  const code = getDisplayCode(property, aiState);
  if (!property || !property.id) {
    return `Para disponibilidad de ${code || 'esa referencia'}, prefiero validarlo con un asesor para no darte información incorrecta.${nameTail(hasName, waProfileName, aiState)}`;
  }
  const statusRaw = cleanSpaces(String(property.status || ''));
  const statusLower = normalizeText(statusRaw);
  if (statusRaw && (statusLower.includes('activ') || statusLower.includes('dispon'))) {
    return `En sistema veo el estatus "${statusRaw}" para ${code}, pero para disponibilidad al día de hoy prefiero validarlo con un asesor y no prometerte algo que pueda cambiar.${nameTail(hasName, waProfileName, aiState)}`;
  }
  return `Para disponibilidad al día de hoy de ${code}, prefiero validarlo con un asesor para no darte información incorrecta. Si quieres, te canalizo con alguien para confirmarlo.${nameTail(hasName, waProfileName, aiState)}`;
}

function buildPropertyLocationReply({ property, aiState = {}, contact = null, waProfileName = null }) {
  const hasName = hasValidHumanName(contact, aiState);
  const code = getDisplayCode(property, aiState);
  const zone = getZoneLabel(property, aiState);
  if (!property || !property.id) {
    return `Sobre ${code || 'esa referencia'}, no tengo ubicación verificada en sistema desde aquí.${nameTail(hasName, waProfileName, aiState)}`;
  }
  if (!zone) {
    return `De ${code} no tengo una ubicación textual confirmada en esta conversación; un asesor puede precisarte colonia y puntos de referencia.${nameTail(hasName, waProfileName, aiState)}`;
  }
  return `La propiedad ${code} está ubicada en ${zone}, según los datos que veo en sistema.${nameTail(hasName, waProfileName, aiState)}`;
}

function buildPropertyVisitReply({ property, aiState = {}, contact = null, waProfileName = null }) {
  const hasName = hasValidHumanName(contact, aiState);
  const code = getDisplayCode(property, aiState);
  const base = `Claro. Para coordinar una visita a ${code}, te canalizo con un asesor de Luxetty. ¿Qué día u horario te acomoda mejor?`;
  if (hasName) return base;
  return `${base} Y para registrarte bien, ¿me compartes tu nombre?`;
}

function buildPropertyPhotosReply({ property, aiState = {}, contact = null, waProfileName = null }) {
  const hasName = hasValidHumanName(contact, aiState);
  const code = getDisplayCode(property, aiState);
  const url = property && property.id ? buildPublicPropertyUrl(property) : null;
  if (url) {
    return `Las fotos y render están en la ficha de ${code}:

${url}

Si necesitas material extra, un asesor puede compartirte lo que haya disponible.${nameTail(hasName, waProfileName, aiState)}`.trim();
  }
  return `No tengo un enlace de fotos verificado aquí para ${code}. Un asesor puede enviarte la galería o la ficha completa.${nameTail(hasName, waProfileName, aiState)}`;
}

function buildFrustrationRecoveryReply({ property, aiState = {}, text = '', contact = null, waProfileName = null }) {
  const hasName = hasValidHumanName(contact, aiState);
  const code = getDisplayCode(property, aiState);
  const pending = cleanSpaces(String(aiState.property_pending_user_question || ''));

  if (pending === 'price') {
    return buildPropertyPriceReply({ property, aiState, contact, waProfileName });
  }
  if (pending === 'availability') {
    return buildPropertyAvailabilityReply({ property, aiState, contact, waProfileName });
  }
  if (pending === 'details') {
    return buildPropertyDetailsReply({ property, aiState, contact, waProfileName });
  }
  if (pending === 'visit') {
    return buildPropertyVisitReply({ property, aiState, contact, waProfileName });
  }
  if (pending === 'location') {
    return buildPropertyLocationReply({ property, aiState, contact, waProfileName });
  }
  if (pending === 'photos') {
    return buildPropertyPhotosReply({ property, aiState, contact, waProfileName });
  }

  return `Tienes razón, me fui por una respuesta muy general. Retomo: estás preguntando por ${code}. Te puedo ayudar con detalles, precio, disponibilidad o visita. ¿Qué quieres confirmar primero?${nameTail(hasName, waProfileName, aiState)}`;
}

function buildContinuePropertyInterestReply({ property, aiState = {}, contact = null, waProfileName = null }) {
  const hasName = hasValidHumanName(contact, aiState);
  const code = getDisplayCode(property, aiState);
  if (!property || !property.id) {
    return `Sigo con tu interés en ${code || 'esa propiedad'}. Cuando quieras, dime si prefieres detalles, precio, ubicación, disponibilidad o visita.${nameTail(hasName, waProfileName, aiState)}`;
  }
  return `Listo, seguimos con ${code}. Dime qué quieres revisar: detalles, precio, ubicación, disponibilidad o visita.${nameTail(hasName, waProfileName, aiState)}`;
}

function buildGenericPropertyFollowUpReply({
  property,
  aiState = {},
  contact = null,
  waProfileName = null,
  recentMessages = [],
}) {
  const hasName = hasValidHumanName(contact, aiState);
  const code = getDisplayCode(property, aiState);
  if (!property || !property.id) {
    return `¿En qué más te ayudo con ${code || 'tu consulta'}?${nameTail(hasName, waProfileName, aiState)}`;
  }
  if (shouldAvoidRepeatedPropertyCTA(aiState, recentMessages)) {
    return `Dime qué quieres revisar de ${code}: detalles, precio, ubicación, disponibilidad o visita.${nameTail(hasName, waProfileName, aiState)}`;
  }
  return `Claro, ya ubiqué la propiedad ${code}. ${GENERIC_CTA_PHRASE.charAt(0).toUpperCase()}${GENERIC_CTA_PHRASE.slice(1)}${nameTail(hasName, waProfileName, aiState)}`;
}

/**
 * @param {{ intent: object, property: object|null, aiState: object, contact?: object, waProfileName?: string|null, text?: string, recentMessages?: object[], hasValidName?: boolean }} opts
 */
function buildPropertySpecificReply(opts = {}) {
  const {
    intent = { type: null },
    property = null,
    aiState = {},
    contact = null,
    waProfileName = null,
    text = '',
    recentMessages = [],
    hasValidName: hasNameArg,
  } = opts;

  const hasName =
    typeof hasNameArg === 'boolean' ? hasNameArg : hasValidHumanName(contact, aiState);
  const ctx = { property, aiState, contact, waProfileName };

  switch (intent.type) {
    case 'property_intro':
      return buildPropertyIntroReply(ctx);
    case 'ask_details':
      return buildPropertyDetailsReply(ctx);
    case 'ask_price':
      return buildPropertyPriceReply(ctx);
    case 'ask_availability':
      return buildPropertyAvailabilityReply(ctx);
    case 'ask_location':
      return buildPropertyLocationReply(ctx);
    case 'ask_visit':
      return buildPropertyVisitReply(ctx);
    case 'ask_photos':
      return buildPropertyPhotosReply(ctx);
    case 'frustration_recovery':
      return buildFrustrationRecoveryReply({ ...ctx, text });
    case 'continue_property_interest':
      return buildContinuePropertyInterestReply(ctx);
    case 'property_follow_up_generic':
      return buildGenericPropertyFollowUpReply({ ...ctx, recentMessages });
    default:
      return buildGenericPropertyFollowUpReply({ ...ctx, recentMessages });
  }
}

module.exports = {
  GENERIC_CTA_PHRASE,
  classifyPropertyFollowUp,
  buildPropertySpecificReply,
  buildPropertyIntroReply,
  buildPropertyDetailsReply,
  buildPropertyPriceReply,
  buildPropertyAvailabilityReply,
  buildPropertyLocationReply,
  buildPropertyVisitReply,
  shouldAvoidRepeatedPropertyCTA,
  markPropertyReplyProgress,
  buildPublicPropertyUrl,
  getDisplayCode,
};
