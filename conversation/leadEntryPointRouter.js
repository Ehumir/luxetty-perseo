'use strict';

/**
 * Clasificación de entradas tipo pauta (propiedad específica vs captación vendedor).
 * No toca inventario ni CRM: solo etiqueta intención y construye copy base consultivo.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const { extractPropertyCode, pickNumericPrice } = require('./propertyIntentResolver');
const { formatMoney } = require('../utils/formatting');
const propertyInventoryService = require('../services/propertyInventoryService');

function isPropertyContextState(aiState = {}) {
  const code = cleanSpaces(String(aiState?.property_code || aiState?.direct_property_code || ''));
  return !!(code && (aiState?.property_specific_intent || aiState?.direct_property_reference));
}

const ROBOT_MENU_SNIPPETS = [
  'dime qué quieres revisar',
  'puedo seguir con',
  'te gustaría que te comparta detalles',
  'detalles, precio, ubicación, disponibilidad o visita',
  'precio, ubicación o agendar una visita',
  'detalles, precio, ubicación o agendar',
];

function isPropertyAdEntry(text = '') {
  const t = normalizeText(text);
  if (!t) return false;
  const code = extractPropertyCode(text);
  const interest =
    t.includes('me interesa') ||
    t.includes('me interesaria') ||
    t.includes('me interesaría') ||
    t.includes('interesa la propiedad') ||
    t.includes('interesa la casa') ||
    (t.includes('interesa') && t.includes('propiedad'));
  if (!interest) return false;
  if (t.includes('vender') && t.includes('ayud')) return false;
  return !!(code || t.includes('propiedad') || t.includes('prop.'));
}

function isSellerCaptureAdEntry(text = '') {
  const t = normalizeText(text);
  if (!t) return false;
  if (t.includes('me interesa') && t.includes('propiedad')) return false;
  const helpSell =
    (t.includes('podrian') || t.includes('podrían') || t.includes('pueden') || t.includes('puedo')) &&
    (t.includes('ayudarme') || t.includes('ayuden') || t.includes('ayudar'));
  const sellHouse = t.includes('vender mi casa') || t.includes('vender la casa') || (t.includes('vender') && t.includes('casa'));
  const captacionPhrase =
    t.includes('quiero saber') && t.includes('vender') && (t.includes('casa') || t.includes('propiedad'));
  return (helpSell && (t.includes('vender') || t.includes('venta'))) || sellHouse || captacionPhrase;
}

function extractOfferFollowUpLocation(text = '') {
  const raw = cleanSpaces(text);
  if (!raw || raw.length > 60) return null;
  const t = normalizeText(text);
  if (t.includes('busco') || t.includes('comprar') || t.includes('presupuesto')) return null;
  if (/^en\s+/i.test(raw)) return cleanSpaces(raw.replace(/^en\s+/i, ''));
  return null;
}

function extractSellerCaptureLocation(text = '') {
  const raw = cleanSpaces(text);
  const t = normalizeText(text);
  if (!raw) return null;

  const surHint = /\b(el\s+)?sur\b/i.test(raw) || /\bsur\b/i.test(t);
  if (surHint) return 'Sur';

  const m =
    raw.match(/vender\s+mi\s+casa\s+en\s+(.+)$/i) ||
    raw.match(/casa\s+en\s+([^.?\n!]+)/i) ||
    raw.match(/propiedad\s+en\s+([^.?\n!]+)/i) ||
    raw.match(/en\s+([^.?\n!]+?)\s*$/i);
  if (!m || !m[1]) return null;
  let loc = cleanSpaces(m[1]).replace(/[.?!]+$/g, '');
  loc = loc.replace(/\b(monterrey|mx|mexico|méxico)\b/gi, '').trim();
  if (loc.length > 80) loc = loc.slice(0, 80).trim();
  return loc || null;
}

function classifyEntryPoint(text = '', aiState = {}) {
  const prev = aiState && typeof aiState === 'object' ? aiState : {};
  const t = normalizeText(text || '');
  const code = extractPropertyCode(text) || cleanSpaces(String(prev.property_code || prev.direct_property_code || ''));

  const base = {
    entry_type: 'unknown',
    lead_flow: null,
    property_code: null,
    location_text: null,
    requires_name: true,
    must_present_assistant: true,
    next_missing_field: 'full_name',
  };

  if (isSellerCaptureAdEntry(text)) {
    const loc = extractSellerCaptureLocation(text) || cleanSpaces(String(prev.location_text || '')) || null;
    return {
      ...base,
      entry_type: 'seller_capture_ad',
      lead_flow: 'offer',
      property_code: null,
      location_text: loc,
    };
  }

  if (isPropertyAdEntry(text) && code) {
    return {
      ...base,
      entry_type: 'property_ad',
      lead_flow: 'demand',
      property_code: code,
      location_text: cleanSpaces(String(prev.location_text || '')) || null,
    };
  }

  if (prev.lead_flow === 'offer') {
    const raw = cleanSpaces(text);
    if (raw && !/\bbusco\b/i.test(raw) && !/\bcomprar\b/i.test(raw) && !/\bpresupuesto\b/i.test(normalizeText(text))) {
      const locFollow = extractSellerCaptureLocation(text) || extractOfferFollowUpLocation(text);
      if (locFollow) {
        return {
          ...base,
          entry_type: 'seller_capture_ad',
          lead_flow: 'offer',
          property_code: null,
          location_text: locFollow,
        };
      }
    }
  }

  if (/\bbusco\b/.test(t) || t.includes('quiero comprar') || (t.includes('comprar') && t.includes('casa'))) {
    return { ...base, entry_type: 'buyer_search', lead_flow: 'demand' };
  }

  return base;
}

function applyEntryClassificationToSignals(signals = {}, text = '', prevAiState = {}) {
  const out = signals && typeof signals === 'object' ? { ...signals } : {};
  const meta = classifyEntryPoint(text, prevAiState);
  out.__entry_point_meta = meta;

  if (meta.entry_type === 'seller_capture_ad') {
    out.lead_flow = 'offer';
    out.operation_type = out.operation_type || 'sale';
    if (meta.location_text) out.location_text = meta.location_text;
    out.low_info_campaign_message = false;
    out.intent_lock_sale_owner = true;
  }

  if (meta.entry_type === 'property_ad' && meta.property_code) {
    out.property_code = meta.property_code;
    out.direct_property_code = meta.property_code;
    out.direct_property_reference = true;
    out.property_specific_intent = true;
    out.lead_flow = out.lead_flow === 'offer' ? 'offer' : 'demand';
    out.low_info_campaign_message = false;
  }

  return out;
}

function reassertEntryLeadFlow(nextAiState = {}, entryMeta = null) {
  const n = nextAiState && typeof nextAiState === 'object' ? nextAiState : {};
  if (!entryMeta || entryMeta.entry_type !== 'seller_capture_ad') return n;
  return { ...n, lead_flow: 'offer', operation_type: n.operation_type || 'sale' };
}

function shouldTreatMessageAsName(text = '', aiState = {}) {
  const { extractPossibleName } = require('./parsers');
  return !!extractPossibleName(text, aiState, aiState?.owner_relation);
}

function buildPublicUrlLine(property) {
  if (!property || !property.id) return '';
  const url = propertyInventoryService.buildPublicPropertyUrl(property);
  return url ? `\n\nTe dejo la ficha:\n${url}` : '';
}

function buildInitialEntryReply(context = {}) {
  const { entry = {}, property = null, aiState = {} } = context;
  const code = cleanSpaces(String(entry.property_code || aiState.property_code || aiState.direct_property_code || ''));

  if (entry.entry_type === 'property_ad') {
    const zone = cleanSpaces(
      String(property?.neighborhood || property?.zone || property?.city || aiState.location_text || '')
    );
    const zonePhrase = zone ? ` en ${zone}` : '';
    const opLabel = property && property.id ? propertyInventoryService.propertyOperationLabel(property) : '';
    let opSentence = '';
    if (opLabel === 'en venta') opSentence = 'Está en venta.';
    else if (opLabel === 'en renta') opSentence = 'Está en renta.';
    else if (opLabel === 'en venta y en renta') opSentence = 'Está en venta y en renta.';
    else if (opLabel && opLabel !== 'operación no confirmada en inventario') {
      opSentence = `${opLabel.charAt(0).toUpperCase()}${opLabel.slice(1)}.`;
    }
    const p = property && property.id ? pickNumericPrice(property) : null;
    const priceSentence =
      p != null
        ? `El precio registrado es ${formatMoney(p, property.currency_code || property.currency || 'MXN')}.`
        : '';
    if (!property || !property.id) {
      return `Hola, soy el asistente de Luxetty. Con gusto te ayudo. Estoy revisando la referencia ${code || 'que me compartiste'} en inventario.

Para registrarte bien y canalizarte con un asesor, ¿me compartes tu nombre?`.trim();
    }
    const mid = [opSentence, priceSentence].filter(Boolean).join(' ');
    return `Hola, soy el asistente de Luxetty. Con gusto te ayudo. Ya ubiqué la propiedad ${code}${zonePhrase}.${mid ? ` ${mid}` : ''}

Para registrarte bien y canalizarte con un asesor, ¿me compartes tu nombre?${buildPublicUrlLine(property)}`.trim();
  }

  if (entry.entry_type === 'seller_capture_ad') {
    const loc = cleanSpaces(String(entry.location_text || ''));
    const locBit = loc ? ` con la venta de tu casa en ${loc}` : ' con la venta de tu casa';
    return `Hola, soy el asistente de Luxetty. Con gusto te ayudo${locBit}.

Para registrarte bien y canalizarte con un asesor especializado, ¿me compartes tu nombre?`.trim();
  }

  return `Hola, soy el asistente de Luxetty. Con gusto te ayudo. Para registrarte bien y canalizarte con un asesor, ¿me compartes tu nombre?`;
}

function buildNameAcknowledgementReply(name, context = {}) {
  const n = cleanSpaces(String(name || ''));
  const first = n.split(/\s+/)[0] || n;
  const { entry = {}, aiState = {} } = context;
  const code = cleanSpaces(String(aiState.property_code || aiState.direct_property_code || entry.property_code || ''));

  if (entry.entry_type === 'property_ad' || isPropertyContextState(aiState)) {
    return `Gracias, ${first}. Ya tengo tu nombre para continuar. Sobre ${code || 'la propiedad'}, puedo ayudarte a confirmar disponibilidad o coordinar una visita con un asesor.`;
  }

  const loc = cleanSpaces(String(entry.location_text || aiState.location_text || ''));
  const locBit = loc ? ` con la venta de tu casa en ${loc}` : ' con la venta de tu casa';
  return `Gracias, ${first}. Para orientarte mejor${locBit}, te hago una pregunta rápida: ¿la propiedad es tuya o estás apoyando a alguien?`;
}

function buildAssistantIdentityReply() {
  return 'Soy el asistente de Luxetty y te ayudo a canalizar tu caso con un asesor especializado. Para registrarte bien, ¿me compartes tu nombre?';
}

function buildComplaintRecoveryReply(context = {}) {
  const { aiState = {}, contact = null, waProfileName = null } = context;
  const { hasValidHumanName } = require('./namePrompt');
  const has = hasValidHumanName(contact, aiState);
  const fn = cleanSpaces(String(aiState.full_name || '')).split(/\s+/)[0];
  const code = cleanSpaces(String(aiState.property_code || aiState.direct_property_code || ''));

  if (has && fn && code) {
    return `Tienes razón, ${fn}. Ya tengo tu nombre registrado. Retomo bien: estás preguntando por ${code}. Puedo ayudarte a confirmar disponibilidad o coordinar visita con un asesor.`;
  }
  if (has && fn) {
    return `Tienes razón, ${fn}. Ya tengo tu nombre registrado. Retomo tu caso con calma: dime qué necesitas resolver ahora y lo vemos paso a paso.`;
  }
  return 'Tienes razón, disculpa la confusión. Para registrarte bien y retomar tu caso con precisión, ¿me compartes tu nombre?';
}

function replyHasRobotMenu(text = '') {
  const t = normalizeText(text);
  return ROBOT_MENU_SNIPPETS.some((s) => t.includes(s));
}

module.exports = {
  classifyEntryPoint,
  isPropertyAdEntry,
  isSellerCaptureAdEntry,
  shouldTreatMessageAsName,
  buildInitialEntryReply,
  buildNameAcknowledgementReply,
  buildAssistantIdentityReply,
  buildComplaintRecoveryReply,
  applyEntryClassificationToSignals,
  reassertEntryLeadFlow,
  replyHasRobotMenu,
  extractSellerCaptureLocation,
  extractOfferFollowUpLocation,
};
