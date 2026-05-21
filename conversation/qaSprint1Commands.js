'use strict';

/**
 * Sprint 1 — Comandos QA seguros (!reset, !resetcrm, !state, !close, !leadcheck).
 * Sin OpenAI, sin CRM, sin búsqueda de propiedades en estos turnos.
 */

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

const { RESET_CONVERSATION_REPLY: REPLY_RESET } = require('./v3/composer/humanCopyV1');
const REPLY_CLOSE = 'Listo, cerré esta conversación de prueba.';

/**
 * Allowlist QA Sprint 1 — misma regla que comandos QA legacy (`qaCommands.isQaCommandAllowed`):
 * números internos MX + `QA_ALLOWED_WHATSAPP_NUMBERS`. Carga perezosa para evitar dependencia circular.
 * @param {string} from
 * @returns {boolean}
 */
function isSprint1QaTesterPhone(from) {
  const { isQaCommandAllowed } = require('./qaCommands');
  return isQaCommandAllowed(from);
}

/**
 * Comandos exactos (tras normalizeQaInput), case-insensitive en el comando.
 * @returns {'reset'|'resetcrm'|'state'|'close'|'leadcheck'|null}
 */
function parseSprint1StrictCommand(text) {
  const raw = normalizeQaInput(text);
  if (raw.length > 32) return null;
  const t = raw.toLowerCase();
  if (t === '!reset') return 'reset';
  if (t === '!resetcrm') return 'resetcrm';
  if (t === '!state') return 'state';
  if (t === '!close') return 'close';
  if (t === '!leadcheck') return 'leadcheck';
  return null;
}

function formatStateSummary(conversationRow, aiState) {
  const safe = (v) => (v == null || v === '' ? '(vacío)' : String(v));
  const boolSafe = (v) => (v === true ? 'true' : v === false ? 'false' : safe(v));
  const lines = [
    `lead_flow: ${safe(aiState?.lead_flow)}`,
    `operation_type: ${safe(aiState?.operation_type)}`,
    `full_name: ${safe(aiState?.full_name)}`,
    `awaiting_field: ${safe(aiState?.awaiting_field)}`,
    `location_text: ${safe(aiState?.location_text)}`,
    `property_type: ${safe(aiState?.property_type)}`,
    `occupancy_status: ${safe(aiState?.occupancy_status)}`,
    `expected_price: ${safe(aiState?.expected_price)}`,
    `conversation_stage: ${safe(aiState?.conversation_stage)}`,
    `identity_state: ${safe(aiState?.identity_state)}`,
    `conversation_goal: ${safe(aiState?.conversation_goal)}`,
    `goal_locked: ${boolSafe(aiState?.conversation_goal_locked)}`,
    `last_question: ${safe(aiState?.last_question)}`,
    `budget_max: ${safe(aiState?.budget_max)}`,
    `bedrooms: ${safe(aiState?.bedrooms)}`,
    `qualification_complete: ${boolSafe(aiState?.qualification_complete)}`,
    `advisor_contact_consent: ${safe(aiState?.advisor_contact_consent)}`,
    `handoff_stage: ${safe(aiState?.handoff_stage)}`,
    `crm_payload_ready: ${boolSafe(aiState?.crm_payload_ready)}`,
    `qualification_missing_slots: ${safe(Array.isArray(aiState?.qualification_missing_slots) ? aiState.qualification_missing_slots.join(',') : aiState?.qualification_missing_slots)}`,
    `must_have_features: ${safe(Array.isArray(aiState?.must_have_features) ? aiState.must_have_features.join(',') : aiState?.must_have_features)}`,
    `property_code: ${safe(aiState?.property_code)}`,
    `property_specific_intent: ${safe(aiState?.property_specific_intent)}`,
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
    getV3Session,
    setV3Session,
    logEvent,
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

  if (cmd === 'resetcrm') {
    const { executeQaCrmReset } = require('./v3/qa/qaCrmReset');
    const crmReset = await executeQaCrmReset({
      phone: from,
      conversationId,
      conversationRow,
      qaCommandsAllowed: allowed,
      saveStateFn,
      updateConversationFn,
      supabase,
      normalizeAiState,
      getV3Session,
      setV3Session,
      saveEventFn,
      nowIso,
      logEvent,
    });
    return {
      handled: true,
      messages: [crmReset.message],
      nextAiState: crmReset.nextAiState,
      conversationUpdate: crmReset.conversationUpdate,
    };
  }

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
    let aiState = normalizeAiState(conversationRow?.ai_state);
    if (typeof getV3Session === 'function') {
      try {
        const { mergeLegacyAiStateWithV3 } = require('./v3/state/v3ToLegacyAiState');
        const v3Session = getV3Session(conversationId);
        if (v3Session) {
          aiState = normalizeAiState(mergeLegacyAiStateWithV3(aiState, v3Session));
        }
      } catch {
        // QA state sigue con legacy si el bridge V3 no está disponible
      }
    }
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
  formatStateSummary,
  REPLY_RESET,
  REPLY_CLOSE,
};
