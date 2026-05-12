'use strict';

const { cleanSpaces } = require('../utils/text');
const propertyInventoryService = require('../services/propertyInventoryService');

function pickCurrentProperty(p) {
  if (!p || typeof p !== 'object') return null;
  const n = propertyInventoryService.normalizeInventoryProperty(p);
  if (!n) return null;
  return {
    code: n.code,
    title: n.title,
    operation_label: n.operation_label,
    price_label: n.price_label,
    location_label: n.location_label,
    bedrooms: n.bedrooms,
    bathrooms: n.bathrooms,
    construction_m2: n.construction_m2,
    terrain_m2: n.terrain_m2,
    highlights: n.highlights,
    public_url: n.public_url,
  };
}

function buildAdvisorContext(input = {}) {
  const ai = input.aiState && typeof input.aiState === 'object' ? input.aiState : {};
  const property = pickCurrentProperty(input.currentProperty || ai.property_context || null);
  const history = Array.isArray(ai.property_history) ? ai.property_history : [];
  const recent = Array.isArray(input.recentMessages) ? input.recentMessages : [];
  const lastAssistantMessages = recent
    .filter((m) => m?.direction === 'outbound')
    .slice(-4)
    .map((m) => String(m?.message_text || '').trim())
    .filter(Boolean);

  const fullName = cleanSpaces(String(ai.full_name || '')) || null;

  return {
    dominant_playbook: ai.active_playbook || null,
    active_intent: ai.active_intent || ai.intent_type || null,
    current_property: property,
    buyer_context: {
      location_text: ai.location_text || null,
      budget_max: ai.budget_max ?? null,
      budget_currency: ai.budget_currency || null,
      bedrooms: ai.bedrooms ?? null,
    },
    seller_context: {
      operation_type: ai.operation_type || null,
      owner_relation: ai.owner_relation || null,
      sale_motivation: ai.sale_motivation || null,
    },
    property_history: history,
    user: {
      full_name: fullName,
      missing_name: !fullName,
    },
    crm: {
      contact_id: input.contactId || null,
      lead_id: input.leadId || null,
      interested_property_id: ai.interested_property_id || null,
      assigned_agent_profile_id: input.assignedAgentProfileId || null,
    },
    recent_messages: recent,
    last_assistant_messages: lastAssistantMessages,
    pending_visit: !!ai.visit_coordination_pending,
    missing_fields: Array.isArray(ai.missing_information) ? ai.missing_information : [],
    emotional_signal: ai.complaint_followup ? 'frustration' : 'neutral',
    forbidden_phrases: [
      'Dime qué quieres revisar de',
      'Puedo seguir con',
      '¿Te gustaría que te comparta detalles, precio, ubicación o agendar una visita?',
      'detalles, precio, ubicación, disponibilidad o visita',
    ],
    allowed_facts: {
      current_property: property,
      buyer_context: {
        location_text: ai.location_text || null,
        budget_max: ai.budget_max ?? null,
      },
      seller_context: {
        operation_type: ai.operation_type || null,
      },
    },
    constraints: [
      'No inventar precio, disponibilidad, links ni asesor asignado',
      'Solo links luxetty.com',
      'Usar facts reales del backend',
    ],
    conversational_goal: ai.active_playbook === 'buyer_search' ? 'qualify_buyer_search' : 'answer_current_intent',
  };
}

module.exports = {
  buildAdvisorContext,
};
