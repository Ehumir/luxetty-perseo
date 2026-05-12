'use strict';

const { normalizeText } = require('../utils/text');

const FRUSTRATION_PATTERNS = [
  'ya vi que eres un bot',
  'eres un bot',
  'no me estas entendiendo',
  'no me estás entendiendo',
  'no me entiendes',
  'no entiendes',
];

function looksLikeVisitTimeProposal(t) {
  return (
    t.includes('mañana') ||
    t.includes('manana') ||
    t.includes('hoy') ||
    /\ba las\s+\d/.test(t) ||
    /\b\d{1,2}:\d{2}\b/.test(t) ||
    /\b\d{1,2}\s*(am|pm)\b/.test(t) ||
    /\b(am|pm)\b/.test(t)
  );
}

function routePropertyFollowUpIntent(text = '', aiState = {}) {
  const t = normalizeText(text);
  if (!t) return { type: null };

  if (aiState?.visit_coordination_pending && looksLikeVisitTimeProposal(t)) {
    return { type: 'visit_time_proposed' };
  }

  if (FRUSTRATION_PATTERNS.some((p) => t.includes(p))) return { type: 'frustration_recovery' };
  if (t.includes('asesor') || t.includes('quien me atendera') || t.includes('quién me atenderá')) {
    return { type: 'ask_agent_identity' };
  }
  if (t.includes('todo') || t.includes('dame todo')) return { type: 'ask_all_available_info' };
  if (t.includes('fotos') || t.includes('foto')) return { type: 'ask_photos' };
  if (t.includes('ubicacion') || t.includes('ubicación') || t.includes('donde') || t.includes('dirección')) {
    return { type: 'ask_location' };
  }
  if (t.includes('disponible') || t.includes('disponibilidad')) return { type: 'ask_availability' };
  if (t.includes('precio') || t.includes('cuanto cuesta') || t.includes('cuánto cuesta')) return { type: 'ask_price' };
  if (t.includes('detalles') || t.includes('dame detalles') || t.includes('informacion')) return { type: 'ask_details' };
  if (
    t.includes('visita') ||
    t.includes('quiero verla') ||
    t.includes('quiero ver la propiedad') ||
    t.includes('cuando puedo verla') ||
    t.includes('cuándo puedo verla')
  ) {
    return { type: 'ask_visit' };
  }
  if (looksLikeVisitTimeProposal(t)) return { type: 'visit_time_proposed' };

  return { type: null };
}

module.exports = {
  routePropertyFollowUpIntent,
  looksLikeVisitTimeProposal,
};
