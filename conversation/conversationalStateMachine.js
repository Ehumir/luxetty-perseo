'use strict';

const { normalizeText, cleanSpaces } = require('../utils/text');

const PLAYBOOKS = {
  PROPERTY_SPECIFIC: 'property_specific',
  BUYER_SEARCH: 'buyer_search',
  SELLER_CAPTURE: 'seller_capture',
  MIXED_INTEREST: 'mixed_interest',
  ADVISOR_HANDOFF: 'advisor_handoff',
  QA_MODE: 'qa_mode',
};

/**
 * Pregunta amplia de inventario / zonas: salir de property_specific hacia buyer_search sin borrar historial.
 */
function shouldSoftExitPropertyToBuyerSearch(text) {
  const t = normalizeText(text);
  if (!t) return false;

  if (/\btienes\s+(algo|opciones|cosas)\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bhay\s+(algo|opciones|cosas)\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bque\s+tienen\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bque\s+tienes\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bmanejan\b/.test(t) && /\ben\b/.test(t)) return true;
  if (t.includes('busco algo') && /\ben\b/.test(t)) return true;
  if (t.includes('buscar algo') && /\ben\b/.test(t)) return true;

  return false;
}

function explicitBuyerPivot(text) {
  const t = normalizeText(text);
  return (
    t.includes('quiero comprar') ||
    t.includes('busco casa') ||
    t.includes('busco depa') ||
    t.includes('busco departamento') ||
    t.includes('busco terreno') ||
    t.includes('busco una propiedad') ||
    t.includes('quiero rentar') ||
    t.includes('busco renta') ||
    (t.includes('busco') && (t.includes('millones') || t.includes('millon') || t.includes('presupuesto')))
  );
}

/**
 * Ajusta señales ya parseadas (post resolvePropertyIntent) con playbooks y flags de contexto.
 * @param {{ text: string, prevAiState: object, parsedSignals: object }} input
 * @returns {object} parche plano para Object.assign(parsedSignals, patch)
 */
function computeSignalPatch({ text, prevAiState = {}, parsedSignals = {} } = {}) {
  const p = parsedSignals && typeof parsedSignals === 'object' ? parsedSignals : {};
  const prev = prevAiState && typeof prevAiState === 'object' ? prevAiState : {};
  const t = normalizeText(text);
  const patch = {};

  if (p.__softExitPropertyMode) {
    patch.active_playbook = PLAYBOOKS.BUYER_SEARCH;
    patch.previous_playbook = prev.active_playbook || PLAYBOOKS.PROPERTY_SPECIFIC;
    patch.secondary_playbook = null;
    patch.buyer_context_active = true;
    patch.seller_context_active = prev.seller_context_active === true || prev.lead_flow === 'offer';
    patch.active_intent = 'buyer_search';
    patch.secondary_intent = patch.seller_context_active ? 'seller_listing' : null;
    patch.conversational_phase = 'discovery';
    patch.contextual_subject = 'inventory_search';
    return patch;
  }

  if (p.sell_buy_bridge || (t.includes('vender') && t.includes('comprar'))) {
    patch.mixed_interest = true;
    patch.seller_context_active = true;
    patch.buyer_context_active = true;
    patch.active_playbook = PLAYBOOKS.MIXED_INTEREST;
    patch.secondary_playbook = PLAYBOOKS.BUYER_SEARCH;
    patch.previous_playbook = prev.active_playbook || null;
    patch.active_intent = 'sell_and_buy';
    patch.secondary_intent = 'buyer_search';
    patch.conversational_phase = 'parallel_capture';
    return patch;
  }

  const code = cleanSpaces(String(p.property_code || p.direct_property_code || ''));
  const propertyMode = !!(p.property_specific_intent && code);

  if (propertyMode) {
    patch.active_playbook = PLAYBOOKS.PROPERTY_SPECIFIC;
    patch.contextual_subject = 'property_listing';
    patch.contextual_reference = code;
    patch.contextual_subject_code = code;
    patch.active_intent = 'property_detail';
    if (prev.seller_context_active || prev.lead_flow === 'offer') {
      patch.secondary_playbook = PLAYBOOKS.SELLER_CAPTURE;
      patch.secondary_intent = 'seller_listing';
    }
    return patch;
  }

  if (p.lead_flow === 'offer' || prev.intent_lock_sale_owner === true) {
    patch.active_playbook = PLAYBOOKS.SELLER_CAPTURE;
    patch.seller_context_active = true;
    patch.active_intent = 'seller_listing';
    patch.conversational_phase = prev.conversational_phase === 'parallel_capture' ? 'parallel_capture' : 'seller_qualification';
    if (prev.buyer_context_active || prev.active_playbook === PLAYBOOKS.BUYER_SEARCH) {
      patch.secondary_playbook = PLAYBOOKS.BUYER_SEARCH;
      patch.buyer_context_active = true;
    }
    return patch;
  }

  if (p.lead_flow === 'demand') {
    patch.active_playbook = PLAYBOOKS.BUYER_SEARCH;
    patch.buyer_context_active = true;
    patch.active_intent = 'buyer_search';
    patch.conversational_phase = 'discovery';
    if (prev.seller_context_active || prev.lead_flow === 'offer') {
      patch.secondary_playbook = PLAYBOOKS.SELLER_CAPTURE;
      patch.secondary_intent = 'seller_listing';
      patch.seller_context_active = true;
      patch.mixed_interest = true;
    }
    return patch;
  }

  return {};
}

/**
 * Si el vendedor estaba activo y el parser metió demand por "en zona" corto, re-enfoca offer (sin texto de compra).
 */
function applySellerLocationStickyPatch({ text, prevAiState = {}, parsedSignals = {} } = {}) {
  const prev = prevAiState && typeof prevAiState === 'object' ? prevAiState : {};
  const p = parsedSignals && typeof parsedSignals === 'object' ? parsedSignals : {};
  const t = normalizeText(text);
  const words = cleanSpaces(t).split(/\s+/).filter(Boolean);

  const sellerLocked =
    prev.lead_flow === 'offer' || prev.intent_lock_sale_owner === true || prev.seller_context_active === true;

  if (!sellerLocked) return {};
  if (explicitBuyerPivot(text)) return {};

  if (p.lead_flow !== 'demand') return {};

  const shortFollowUp = words.length > 0 && words.length <= 8;
  const looksLikeZoneOnly =
    shortFollowUp &&
    (/\ben\s+[a-záéíóúñ\s]+\b/.test(t) || /^en\s+[a-záéíóúñ\s]+$/i.test(cleanSpaces(text || ''))) &&
    !t.includes('busco') &&
    !t.includes('comprar') &&
    !t.includes('millones');

  if (!looksLikeZoneOnly) return {};

  return {
    lead_flow: 'offer',
    operation_type: p.operation_type || prev.operation_type || 'sale',
    intent_type: 'supply',
    playbook_type: 'supply',
    buyer_context_active: false,
    active_playbook: PLAYBOOKS.SELLER_CAPTURE,
    active_intent: 'seller_listing',
  };
}

module.exports = {
  PLAYBOOKS,
  shouldSoftExitPropertyToBuyerSearch,
  computeSignalPatch,
  applySellerLocationStickyPatch,
  explicitBuyerPivot,
};
