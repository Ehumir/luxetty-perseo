'use strict';

/**
 * APA Notificaciones P0 — emisor fire-and-forget + dispatch inmediato.
 * Nunca lanza excepciones al caller CRM.
 */

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = require('../config/env');

const DISPATCH_PATH = '/functions/v1/notification-dispatcher';
const DISPATCH_SECRET = process.env.NOTIFICATION_DISPATCH_SECRET || '';

function buildDedupeKey(eventType, parts) {
  const suffix = parts.filter(Boolean).join(':');
  return `${eventType}:${suffix}`;
}

function getDispatcherUrl() {
  const base = (process.env.NOTIFICATION_DISPATCHER_URL || SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}${DISPATCH_PATH}`;
}

async function dispatchImmediate(eventId, deliveryIds = []) {
  const url = getDispatcherUrl();
  const key = SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !eventId) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      apikey: key,
    };
    if (DISPATCH_SECRET) headers['x-notification-dispatch-secret'] = DISPATCH_SECRET;

    await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        action: 'dispatch',
        mode: 'immediate',
        event_id: eventId,
        delivery_ids: deliveryIds.length ? deliveryIds : undefined,
      }),
    });
  } catch {
    // Cron/retry recovery handles failures — must not block CRM
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {object} args
 * @param {function} [logFn]
 */
async function emitNotificationEvent(supabase, args, logFn) {
  const log = typeof logFn === 'function' ? logFn : () => {};

  if (!supabase || typeof supabase.rpc !== 'function') {
    log('notification_emit_skipped', { reason: 'no_supabase' });
    return { ok: false, reason: 'no_supabase' };
  }

  const {
    eventType,
    sourceModule = 'perseo',
    dedupeKey,
    payload = {},
    priority = null,
    conversationId = null,
    contactId = null,
    leadId = null,
    assignedAgentProfileId = null,
  } = args;

  if (!eventType || !dedupeKey) {
    log('notification_emit_skipped', { reason: 'missing_event_type_or_dedupe' });
    return { ok: false, reason: 'missing_fields' };
  }

  try {
    const { data, error } = await supabase.rpc('emit_notification_event', {
      p_event_type: eventType,
      p_source_module: sourceModule,
      p_dedupe_key: dedupeKey,
      p_payload: payload,
      p_priority: priority,
      p_conversation_id: conversationId,
      p_contact_id: contactId,
      p_lead_id: leadId,
      p_assigned_agent_profile_id: assignedAgentProfileId,
    });

    if (error) {
      log('notification_emit_failed', { event_type: eventType, error: error.message });
      return { ok: false, reason: error.message };
    }

    const result = data && typeof data === 'object' ? data : {};
    if (result.duplicate) {
      log('notification_emit_duplicate_blocked', { event_type: eventType, dedupe_key: dedupeKey });
      return { ok: true, duplicate: true, eventId: result.event_id };
    }

    if (result.skipped) {
      log('notification_emit_skipped', { event_type: eventType, reason: result.reason });
      return { ok: true, skipped: true, eventId: result.event_id };
    }

    const eventId = result.event_id;
    const deliveryIds = Array.isArray(result.delivery_ids) ? result.delivery_ids : [];

    if (eventId && deliveryIds.length) {
      dispatchImmediate(eventId, deliveryIds).catch(() => {});
    }

    log('notification_emit_ok', {
      event_type: eventType,
      event_id: eventId,
      delivery_count: deliveryIds.length,
      priority: result.priority,
    });

    return { ok: true, eventId, deliveryIds, priority: result.priority };
  } catch (err) {
    log('notification_emit_failed', {
      event_type: eventType,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: 'unexpected_error' };
  }
}

function emitInboundNewContact(supabase, ctx, logFn) {
  const { conversationId, phone, contactName, messagePreview } = ctx;
  return emitNotificationEvent(
    supabase,
    {
      eventType: 'inbound_new_contact',
      dedupeKey: buildDedupeKey('inbound_new_contact', [conversationId, phone]),
      conversationId,
      payload: {
        phone,
        contact_name_or_phone: contactName || phone,
        last_message_preview: messagePreview || '',
      },
      priority: 'high',
    },
    logFn
  );
}

function emitOwnerOfferDetected(supabase, ctx, logFn) {
  const { conversationId, phone, contactId, contactName, entryType, intentSummary } = ctx;
  return emitNotificationEvent(
    supabase,
    {
      eventType: 'owner_offer_detected',
      dedupeKey: buildDedupeKey('owner_offer_detected', [conversationId]),
      conversationId,
      contactId: contactId || null,
      payload: {
        phone,
        contact_name_or_phone: contactName || phone,
        entry_type: entryType || 'seller_capture_ad',
        intent_summary: intentSummary || 'Captación / oferta de propietario',
      },
      priority: 'critical',
    },
    logFn
  );
}

function emitLeadAssigned(supabase, ctx, logFn) {
  const {
    conversationId,
    contactId,
    leadId,
    assignedAgentProfileId,
    contactName,
    leadType,
    operation,
    zoneOrProperty,
  } = ctx;

  return emitNotificationEvent(
    supabase,
    {
      eventType: 'lead_assigned',
      dedupeKey: buildDedupeKey('lead_assigned', [leadId, assignedAgentProfileId]),
      conversationId,
      contactId,
      leadId,
      assignedAgentProfileId,
      payload: {
        contact_name: contactName || '',
        lead_type: leadType || '',
        operation: operation || '',
        zone_or_property: zoneOrProperty || '',
      },
      priority: 'normal',
    },
    logFn
  );
}

function isOwnerOfferSignal(parsedSignals = {}, nextAiState = {}) {
  const meta = parsedSignals.__entry_point_meta || nextAiState.__entry_point_meta;
  if (meta?.entry_type === 'seller_capture_ad') return true;
  if (nextAiState.lead_flow === 'offer' && !nextAiState.__owner_offer_notified) return true;
  if (parsedSignals.lead_flow === 'offer') return true;
  return false;
}

module.exports = {
  buildDedupeKey,
  emitNotificationEvent,
  emitInboundNewContact,
  emitOwnerOfferDetected,
  emitLeadAssigned,
  isOwnerOfferSignal,
  dispatchImmediate,
};
