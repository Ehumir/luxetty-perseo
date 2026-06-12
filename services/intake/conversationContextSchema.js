'use strict';

const VALID_LANDING_KEYS = new Set([
  'property_demand',
  'cumbres_supply',
  'medical_consultorios',
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asTrimmedString(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/**
 * Valida y normaliza conversation_context persistido en intake_submissions.
 * @returns {{ ok: true, context: object } | { ok: false, error: string }}
 */
function parseConversationContext(raw) {
  const ctx = asObject(raw);
  if (!ctx) {
    return { ok: false, error: 'conversation_context_missing' };
  }

  const landingKey = asTrimmedString(ctx.landing_key);
  if (!landingKey || !VALID_LANDING_KEYS.has(landingKey)) {
    return { ok: false, error: 'invalid_landing_key' };
  }

  const leadId = asTrimmedString(ctx.lead_id);
  const contactId = asTrimmedString(ctx.contact_id);
  if (!leadId || !contactId) {
    return { ok: false, error: 'missing_lead_or_contact' };
  }

  const identity = asObject(ctx.identity) || {};
  const crm = asObject(ctx.crm) || {};
  const perseo = asObject(ctx.perseo) || {};
  const campaign = asObject(ctx.campaign) || {};
  const intent = asObject(ctx.intent) || {};
  const property = asObject(ctx.property) || null;
  const answers = asObject(ctx.answers) || {};

  return {
    ok: true,
    context: {
      intake_id: asTrimmedString(ctx.intake_id),
      landing_key: landingKey,
      landing_slug: asTrimmedString(ctx.landing_slug) || '',
      capture_channel: asTrimmedString(ctx.capture_channel) || landingKey,
      lead_type: asTrimmedString(ctx.lead_type) || (landingKey === 'property_demand' ? 'demand' : 'supply'),
      lead_id: leadId,
      contact_id: contactId,
      identity: {
        full_name: asTrimmedString(identity.full_name) || asTrimmedString(answers.full_name),
        whatsapp: asTrimmedString(identity.whatsapp) || asTrimmedString(answers.whatsapp),
        email: asTrimmedString(identity.email) || asTrimmedString(answers.email),
      },
      intent: {
        primary: asTrimmedString(intent.primary) || null,
        label: asTrimmedString(intent.label) || null,
      },
      campaign,
      answers,
      property,
      crm: {
        solicitud_created: crm.solicitud_created === true,
        contact_reused: crm.contact_reused === true,
        lead_reused: crm.lead_reused === true,
        assigned_agent_profile_id: asTrimmedString(crm.assigned_agent_profile_id),
      },
      perseo: {
        entry_type: asTrimmedString(perseo.entry_type) || defaultEntryType(landingKey),
        requires_solicitud: perseo.requires_solicitud === true,
        gate_window_hours: Number(perseo.gate_window_hours) > 0 ? Number(perseo.gate_window_hours) : 48,
      },
      bridge_token: asTrimmedString(ctx.bridge_token),
      intake_completed_at: asTrimmedString(ctx.intake_completed_at),
    },
  };
}

function defaultEntryType(landingKey) {
  if (landingKey === 'property_demand') return 'property_ad';
  if (landingKey === 'cumbres_supply') return 'seller_capture_ad';
  return 'buyer_search';
}

function isWithinGateWindow(completedAtIso, windowHours = 48) {
  if (!completedAtIso) return false;
  const completedAt = new Date(completedAtIso);
  if (Number.isNaN(completedAt.getTime())) return false;
  const ms = Number(windowHours) * 60 * 60 * 1000;
  return Date.now() - completedAt.getTime() <= ms;
}

module.exports = {
  VALID_LANDING_KEYS,
  parseConversationContext,
  isWithinGateWindow,
};
