'use strict';

/**
 * Sprint 1 — Comandos QA seguros (!reset, !state, !close, !leadcheck).
 * Sin OpenAI, sin CRM, sin búsqueda de propiedades en estos turnos.
 */

const { normalizePhoneNumber } = require('../utils/helpers');

function normalizeQaInput(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    .trim();
}

function normalizePhoneForAllowlist(phone) {
  return String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
}

function maskPhoneForLog(phone) {
  const value = normalizePhoneForAllowlist(phone);
  if (!value) return null;
  if (value.length <= 4) return `***${value}`;
  return `***${value.slice(-4)}`;
}

const REPLY_RESET = 'Listo, reiniciamos la conversación. ¿Qué necesitas revisar ahora?';
const REPLY_CLOSE = 'Listo, cerré esta conversación de prueba.';

const DEFAULT_QA_LOCAL_10 = new Set(['8181877351', '8119086196']);

function isSprint1QaTesterPhone(from) {
  const digits = normalizePhoneForAllowlist(from);
  if (!digits) return false;
  if (DEFAULT_QA_LOCAL_10.has(digits.slice(-10))) return true;
  const n = normalizePhoneNumber(from);
  if (n && DEFAULT_QA_LOCAL_10.has(String(n).slice(-10))) return true;
  return false;
}

/**
 * Comandos exactos (tras normalizeQaInput), case-insensitive en el comando.
 * @returns {'reset'|'state'|'close'|'leadcheck'|null}
 */
function parseSprint1StrictCommand(text) {
  const raw = normalizeQaInput(text);
  if (raw.length > 32) return null;
  const t = raw.toLowerCase();
  if (t === '!reset') return 'reset';
  if (t === '!state') return 'state';
  if (t === '!close') return 'close';
  if (t === '!leadcheck') return 'leadcheck';
  return null;
}

function formatStateSummary(conversationRow, aiState) {
  const safe = (v) => (v == null || v === '' ? '(vacío)' : String(v));
  const lines = [
    `lead_flow: ${safe(aiState?.lead_flow)}`,
    `operation_type: ${safe(aiState?.operation_type)}`,
    `full_name: ${safe(aiState?.full_name)}`,
    `awaiting_field: ${safe(aiState?.awaiting_field)}`,
    `location_text: ${safe(aiState?.location_text)}`,
    `budget_max: ${safe(aiState?.budget_max)}`,
    `bedrooms: ${safe(aiState?.bedrooms)}`,
    `must_have_features: ${safe(Array.isArray(aiState?.must_have_features) ? aiState.must_have_features.join(',') : aiState?.must_have_features)}`,
    `property_code: ${safe(aiState?.property_code)}`,
    `property_specific_intent: ${safe(aiState?.property_specific_intent)}`,
    `active_playbook: ${safe(aiState?.active_playbook)}`,
    `mixed_interest: ${safe(aiState?.mixed_interest)}`,
    `property_history_len: ${safe(Array.isArray(aiState?.property_history) ? aiState.property_history.length : 0)}`,
    `interested_property_id: ${safe(aiState?.interested_property_id)}`,
    `contact_id: ${safe(conversationRow?.contact_id)}`,
    `lead_id: ${safe(conversationRow?.lead_id)}`,
  ];
  return `Estado (QA):\n${lines.join('\n')}`;
}

async function fetchLeadSafeSummary(supabase, leadId) {
  if (!supabase || !leadId) return null;
  try {
    const { data, error } = await supabase
      .from('leads')
      .select('lead_type, assigned_agent_profile_id')
      .eq('id', leadId)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  } catch {
    return null;
  }
}

function formatLeadcheckReply(conversationRow, leadSummary) {
  const hasContact = !!conversationRow?.contact_id;
  const hasLead = !!conversationRow?.lead_id;
  const parts = [
    `contacto vinculado: ${hasContact ? 'sí' : 'no'}`,
    `lead vinculado: ${hasLead ? 'sí' : 'no'}`,
  ];
  if (leadSummary?.lead_type != null) parts.push(`lead_type: ${leadSummary.lead_type}`);
  if (leadSummary?.assigned_agent_profile_id != null) {
    parts.push(`assigned_agent_profile_id: ${leadSummary.assigned_agent_profile_id}`);
  }
  return `Lead check (QA):\n${parts.join('\n')}`;
}

/**
 * @param {object} deps
 * @returns {Promise<null | { unauthorized: true, payload: object } | { handled: true, messages: string[], nextAiState?: object, conversationUpdate?: object }>}
 */
async function processSprint1QaInbound(deps) {
  const {
    text,
    from,
    conversationId,
    conversationRow,
    metaMessageId,
    supabase,
    getDefaultAiState,
    normalizeAiState,
    nowIso,
    saveEventFn,
    saveStateFn,
    updateConversationFn,
    conversations,
    isQaExecutionAllowed,
  } = deps;

  const cmd = parseSprint1StrictCommand(text);
  if (!cmd) return null;

  const auditPhone = maskPhoneForLog(from);

  const allowed =
    typeof isQaExecutionAllowed === 'function' ? isQaExecutionAllowed(from) : isSprint1QaTesterPhone(from);
  if (!allowed) {
    return {
      unauthorized: true,
      payload: {
        command: cmd,
        from_masked: auditPhone,
        meta_message_id: metaMessageId || null,
        conversation_id: conversationId || null,
      },
    };
  }

  if (!conversationId) {
    return { handled: true, messages: ['No hay conversación activa para este comando QA.'] };
  }

  const baseAudit = {
    command: cmd,
    from_masked: auditPhone,
    meta_message_id: metaMessageId || null,
    conversation_id: conversationId,
    ts: nowIso(),
  };

  if (cmd === 'reset') {
    const fresh = getDefaultAiState();
    if (conversations && typeof conversations.set === 'function') {
      conversations.set(from, []);
    }
    await saveStateFn(conversationId, fresh);
    await saveEventFn(conversationId, 'qa_reset_executed', {
      ...baseAudit,
      action: 'ai_state_reset_to_default',
    });
    return { handled: true, messages: [REPLY_RESET], nextAiState: fresh };
  }

  if (cmd === 'state') {
    const aiState = normalizeAiState(conversationRow?.ai_state);
    const msg = formatStateSummary(conversationRow, aiState);
    await saveEventFn(conversationId, 'qa_state_viewed', { ...baseAudit });
    return { handled: true, messages: [msg] };
  }

  if (cmd === 'close') {
    const fresh = getDefaultAiState();
    await saveStateFn(conversationId, fresh);
    if (updateConversationFn && supabase) {
      await updateConversationFn(supabase, conversationId, {
        status: 'closed',
        ai_state: fresh,
        updated_at: nowIso(),
      });
    }
    await saveEventFn(conversationId, 'qa_conversation_closed', { ...baseAudit });
    return { handled: true, messages: [REPLY_CLOSE], nextAiState: fresh, conversationUpdate: { status: 'closed' } };
  }

  if (cmd === 'leadcheck') {
    const leadSummary = await fetchLeadSafeSummary(supabase, conversationRow?.lead_id);
    const msg = formatLeadcheckReply(conversationRow, leadSummary);
    await saveEventFn(conversationId, 'qa_leadcheck_viewed', { ...baseAudit });
    return { handled: true, messages: [msg] };
  }

  return null;
}

module.exports = {
  parseSprint1StrictCommand,
  isSprint1QaTesterPhone,
  processSprint1QaInbound,
  REPLY_RESET,
  REPLY_CLOSE,
};
