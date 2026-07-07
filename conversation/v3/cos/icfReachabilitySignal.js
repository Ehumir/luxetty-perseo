'use strict';

const { supabase } = require('../../../services/supabaseService');
const { v3Log } = require('../core/v3Logger');

const POSITIVE_INTENTS = new Set([
  'sell',
  'buy',
  'rent_out',
  'rent',
  'invest',
  'supply_capture',
  'demand_capture',
  'property_interest',
  'visit_intent',
  'advisor_consent_capture',
]);

const DEFERRED_PATTERNS = [
  /\bdespues\b/,
  /\bdespués\b/,
  /\bluego\b/,
  /\bmañana\b/,
  /\bmanana\b/,
  /\bahora no\b/,
];

/**
 * Maps PERSEO conversation signals → OVE reachability_signal for ICF suggest/close.
 * Best-effort; never throws to caller.
 */
function mapReachabilitySignal({ detectedIntent, userText, inbound }) {
  const text = String(userText || '').toLowerCase();
  if (inbound === false) return null;

  if (DEFERRED_PATTERNS.some((re) => re.test(text))) {
    return 'client_deferred';
  }

  if (detectedIntent && POSITIVE_INTENTS.has(String(detectedIntent))) {
    return 'intent_positive';
  }

  if (/\b(?:si|sí|claro|adelante|ok|vale|perfecto)\b/.test(text) && text.length <= 80) {
    return 'responded_engaged';
  }

  return null;
}

async function syncIcfReachabilityFromConversation({
  leadId,
  detectedIntent,
  userText,
  inbound = true,
  metadata = {},
}) {
  if (!leadId) return { skipped: true, reason: 'no_lead_id' };

  const signal = mapReachabilitySignal({ detectedIntent, userText, inbound });
  if (!signal) return { skipped: true, reason: 'no_signal' };

  try {
    const { data, error } = await supabase.rpc('icf_update_reachability_signal', {
      p_lead_id: leadId,
      p_signal: signal,
      p_metadata: {
        ...metadata,
        detected_intent: detectedIntent ?? null,
        user_text_preview: String(userText || '').slice(0, 200),
      },
      p_source: 'perseo',
    });

    if (error) {
      v3Log('icf_reachability_error', { lead_id: leadId, error: error.message });
      return { ok: false, error: error.message };
    }

    v3Log('icf_reachability_synced', { lead_id: leadId, signal, result: data });
    return { ok: true, signal, data };
  } catch (err) {
    v3Log('icf_reachability_exception', { lead_id: leadId, error: String(err?.message || err) });
    return { ok: false, error: String(err?.message || err) };
  }
}

module.exports = {
  mapReachabilitySignal,
  syncIcfReachabilityFromConversation,
};
