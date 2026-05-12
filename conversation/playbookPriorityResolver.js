'use strict';

const { normalizeText, cleanSpaces } = require('../utils/text');
const { extractPropertyCode } = require('./propertyIntentResolver');

function looksLikePropertySpecificState(s) {
  const code = cleanSpaces(String(s.property_code || s.direct_property_code || ''));
  if (!code) return false;
  return !!(s.property_specific_intent || s.direct_property_reference);
}

const PLAYBOOKS = {
  PROPERTY_SPECIFIC: 'property_specific',
  BUYER_SEARCH: 'buyer_search',
  SELLER_CAPTURE: 'seller_capture',
  MIXED_INTEREST: 'mixed_interest',
  ADVISOR_HANDOFF: 'advisor_handoff',
  QA_MODE: 'qa_mode',
};

/**
 * Inventario / búsqueda amplia (sale de property lock sin código nuevo en el turno).
 */
function broadInventoryBuyerIntent(text) {
  const t = normalizeText(text);
  if (!t) return false;

  if (/\btien(en|es)?\s+(algo|opciones|cosas)\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bhay\s+(algo|opciones|cosas)\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bque\s+(mas|más)\s+tienen\b/.test(t)) return true;
  if (/\bque\s+(otra|otro)\s+(propiedad|casa|opcion|opción)\b/.test(t)) return true;
  if (t.includes('busco otra zona') || t.includes('otra zona')) return true;
  if (t.includes('algo parecido') || t.includes('algo similar')) return true;
  if (t.includes('propiedades similares') || t.includes('otra propiedad')) return true;
  if (/\b(maximo|máximo|hasta)\s+[\d.]+\s*(millon|millón|m\b)/.test(t)) return true;
  if (/\b\d\s*(millones|millon|millón)\b/.test(t)) return true;
  if (/\b(recamaras|recámaras|habitaciones)\b/.test(t) && (t.includes('busco') || t.includes('quiero') || t.includes('con'))) return true;
  if (t.includes('misma zona') || t.includes('esa misma zona')) return true;
  if (t.includes('busco algo') || t.includes('quiero una')) return true;
  if (t.includes('cuando puedo verla') || t.includes('cuándo puedo verla')) return false;

  if (/\btienes\s+(algo|opciones|cosas)\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bhay\s+(algo|opciones|cosas)\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bque\s+tienen\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bque\s+tienes\b/.test(t) && /\ben\b/.test(t)) return true;
  if (/\bmanejan\b/.test(t) && /\ben\b/.test(t)) return true;
  if (t.includes('busco algo') && /\ben\b/.test(t)) return true;
  if (t.includes('buscar algo') && /\ben\b/.test(t)) return true;

  return false;
}

/**
 * Eleva buyer_search cuando ya hubo property pero el mensaje actual es búsqueda amplia (sin código).
 */
function shouldElevateBuyerSearchOverProperty(text, prevAiState = {}, parsedSignals = {}) {
  const incoming = cleanSpaces(String(parsedSignals.property_code || parsedSignals.direct_property_code || ''));
  if (incoming) return false;
  const prev = prevAiState && typeof prevAiState === 'object' ? prevAiState : {};
  const hadProperty =
    !!(prev.property_specific_intent || cleanSpaces(String(prev.property_code || prev.direct_property_code || '')));
  if (!hadProperty) return false;
  return broadInventoryBuyerIntent(text);
}

function resolveDominantPlaybook(aiState = {}, currentIntent = null, recentMessages = []) {
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  if (cleanSpaces(String(s.active_playbook || ''))) return s.active_playbook;
  if (looksLikePropertySpecificState(s)) return PLAYBOOKS.PROPERTY_SPECIFIC;
  if (s.lead_flow === 'offer') return PLAYBOOKS.SELLER_CAPTURE;
  if (s.lead_flow === 'demand') return PLAYBOOKS.BUYER_SEARCH;
  return null;
}

function shouldContinuePropertyTopic(aiState = {}) {
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  if (s.visit_coordination_pending === true) return true;
  const p = cleanSpaces(String(s.property_pending_user_question || ''));
  if (['visit', 'availability'].includes(p)) return true;
  return false;
}

function shouldUsePropertySpecificFlow(aiState = {}, currentIntent = null) {
  if (shouldContinuePropertyTopic(aiState)) return true;
  const dom = resolveDominantPlaybook(aiState);
  if (dom === PLAYBOOKS.BUYER_SEARCH) return false;
  if (dom === PLAYBOOKS.SELLER_CAPTURE) return false;
  if (dom === PLAYBOOKS.MIXED_INTEREST) return false;
  if (dom === PLAYBOOKS.PROPERTY_SPECIFIC) return true;
  const pr = require('./propertyIntentResolver');
  return pr.isPropertySpecificConversation(aiState);
}

function shouldUseBuyerSearchFlow(aiState = {}, currentIntent = null) {
  return resolveDominantPlaybook(aiState) === PLAYBOOKS.BUYER_SEARCH;
}

function shouldUseSellerFlow(aiState = {}, currentIntent = null) {
  return resolveDominantPlaybook(aiState) === PLAYBOOKS.SELLER_CAPTURE;
}

function shouldSoftExitPropertyMode(message, aiState = {}) {
  const text = String(message || '');
  if (extractPropertyCode(text)) return false;
  return broadInventoryBuyerIntent(text);
}

function shouldPreservePropertyContext(aiState = {}) {
  const s = aiState && typeof aiState === 'object' ? aiState : {};
  return (
    (Array.isArray(s.property_history) && s.property_history.length > 0) ||
    !!cleanSpaces(String(s.current_property_code || ''))
  );
}

module.exports = {
  PLAYBOOKS,
  resolveDominantPlaybook,
  shouldUsePropertySpecificFlow,
  shouldUseBuyerSearchFlow,
  shouldUseSellerFlow,
  shouldSoftExitPropertyMode,
  shouldPreservePropertyContext,
  broadInventoryBuyerIntent,
  shouldElevateBuyerSearchOverProperty,
  shouldContinuePropertyTopic,
};
