'use strict';

/**
 * Sprint 2 — Gatekeeper único PERSEO (ATENA/PERSEO arquitectura v2).
 *
 * Centraliza decisión IA vs bloqueo automatizado. Sin caché: lectura SQL directa
 * de `public.ai_conversation_channel_settings` cuando PERSEO_POLICY_V2_ENABLED=true.
 *
 * Alineado con `luxetty-atena/supabase/functions/_shared/perseo-ai-control.ts`
 * para normalización de `conversations.ai_state`.
 */

const { isSprint1QaTesterPhone } = require('./qaSprint1Commands');

/** Códigos estables para logs, eventos y métricas (no usar strings libres). */
const PERSEO_REASON_CODES = Object.freeze({
  AUTOMATION_ALLOWED: 'AUTOMATION_ALLOWED',
  /** Flag V2 apagado: no se lee tabla global; solo control por conversación. */
  LEGACY_POLICY_V2_DISABLED: 'LEGACY_POLICY_V2_DISABLED',
  CONVERSATION_HUMAN_ATTENTION: 'CONVERSATION_HUMAN_ATTENTION',
  HUMAN_ONLY_GLOBAL_ACTIVE: 'HUMAN_ONLY_GLOBAL_ACTIVE',
  AUTOMATION_DISABLED_GLOBAL: 'AUTOMATION_DISABLED_GLOBAL',
  POLICY_SETTINGS_READ_FAILED: 'POLICY_SETTINGS_READ_FAILED',
  POLICY_SETTINGS_ROW_MISSING: 'POLICY_SETTINGS_ROW_MISSING',
  POLICY_SETTINGS_PARSE_INVALID: 'POLICY_SETTINGS_PARSE_INVALID',
  POLICY_RESOLUTION_UNEXPECTED: 'POLICY_RESOLUTION_UNEXPECTED',
  QA_OUTBOUND_NOT_ALLOWLISTED: 'QA_OUTBOUND_NOT_ALLOWLISTED',
  OUTBOUND_MESSAGES_EMPTY: 'OUTBOUND_MESSAGES_EMPTY',
});

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {object|null} conversationRow
 * @returns {{ attention_mode: 'perseo' | 'human', ai_paused: boolean, source: 'persisted' | 'default' }}
 */
function normalizePerseoAiControlFromRow(conversationRow) {
  const aiState = conversationRow?.ai_state;
  if (!isRecord(aiState)) {
    return { attention_mode: 'perseo', ai_paused: false, source: 'default' };
  }

  const rawControl = aiState.ai_control;
  const control = isRecord(rawControl) ? rawControl : {};
  const rawMode = control.attention_mode ?? aiState.attention_mode;
  const rawPaused = control.ai_paused ?? aiState.ai_paused;
  const hasPersistedSignal =
    rawMode === 'human' || rawMode === 'perseo' || typeof rawPaused === 'boolean';

  const isHumanControlled =
    control.ai_paused === true ||
    aiState.ai_paused === true ||
    control.attention_mode === 'human' ||
    aiState.attention_mode === 'human';

  if (isHumanControlled) {
    return { attention_mode: 'human', ai_paused: true, source: 'persisted' };
  }

  return {
    attention_mode: 'perseo',
    ai_paused: false,
    source: hasPersistedSignal ? 'persisted' : 'default',
  };
}

function isPerseoPolicyV2Enabled() {
  return process.env.PERSEO_POLICY_V2_ENABLED === 'true';
}

/** Logs JSON en una línea; activar solo en diagnóstico (P0). No loguear teléfonos completos. */
function maybeLogPolicyDebug(globalRow, policy) {
  if (process.env.PERSEO_POLICY_DEBUG_LOG !== 'true') return;
  console.info(
    'perseo_policy_debug',
    JSON.stringify({
      ts: new Date().toISOString(),
      perseo_policy_v2_enabled: isPerseoPolicyV2Enabled(),
      reads_ai_conversation_channel_settings: isPerseoPolicyV2Enabled(),
      human_only_global: globalRow && typeof globalRow.human_only_global === 'boolean' ? globalRow.human_only_global : null,
      automation_enabled:
        globalRow && typeof globalRow.automation_enabled === 'boolean' ? globalRow.automation_enabled : null,
      policyResolution: policy.policyResolution,
      allowAutomatedReply: policy.allowAutomatedReply,
      allowQaBypass: policy.allowQaBypass,
      effectiveHumanLock: policy.effectiveHumanLock,
      reason_code: policy.reason_code,
    })
  );
}

/**
 * Lectura directa singleton id=true (sin caché en Sprint 2).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function fetchAiConversationChannelSettingsRow(supabase) {
  try {
    if (!supabase) {
      return {
        ok: false,
        errorCode: PERSEO_REASON_CODES.POLICY_SETTINGS_READ_FAILED,
        detail: 'supabase_client_missing',
      };
    }
    const { data, error } = await supabase
      .from('ai_conversation_channel_settings')
      .select('human_only_global, automation_enabled')
      .eq('id', true)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        errorCode: PERSEO_REASON_CODES.POLICY_SETTINGS_READ_FAILED,
        detail: error.message || String(error),
      };
    }
    if (!data) {
      return { ok: false, errorCode: PERSEO_REASON_CODES.POLICY_SETTINGS_ROW_MISSING, detail: null };
    }
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      errorCode: PERSEO_REASON_CODES.POLICY_RESOLUTION_UNEXPECTED,
      detail: err && err.message ? err.message : String(err),
    };
  }
}

/**
 * @typedef {'ok'|'error'} PolicyResolution
 * @typedef {object} AutomatedReplyPolicy
 * @property {PolicyResolution} policyResolution
 * @property {boolean} allowAutomatedReply
 * @property {boolean} allowQaBypass  — solo allowlist QA (nunca bypass global).
 * @property {boolean} effectiveHumanLock
 * @property {string} reason_code — una de PERSEO_REASON_CODES
 */

/**
 * Resolución única de política outbound IA / QA allowlist.
 *
 * @param {object} args
 * @param {import('@supabase/supabase-js').SupabaseClient|null} args.supabase
 * @param {object|null} args.conversationRow
 * @param {string} args.from — teléfono WhatsApp normalizado
 * @returns {Promise<AutomatedReplyPolicy>}
 */
async function resolveAutomatedReplyPolicy({ supabase, conversationRow, from }) {
  const allowQaBypass = isSprint1QaTesterPhone(from);

  try {
    const conv = normalizePerseoAiControlFromRow(conversationRow);
    const conversationHumanLock = conv.attention_mode === 'human' || conv.ai_paused === true;

    if (!isPerseoPolicyV2Enabled()) {
      const allowAutomatedReply = !conversationHumanLock;
      const out = {
        policyResolution: 'ok',
        allowAutomatedReply,
        allowQaBypass,
        effectiveHumanLock: conversationHumanLock,
        reason_code: allowAutomatedReply
          ? PERSEO_REASON_CODES.AUTOMATION_ALLOWED
          : PERSEO_REASON_CODES.CONVERSATION_HUMAN_ATTENTION,
      };
      maybeLogPolicyDebug(null, out);
      return out;
    }

    const fetched = await fetchAiConversationChannelSettingsRow(supabase);
    if (!fetched.ok) {
      const out = {
        policyResolution: 'error',
        allowAutomatedReply: false,
        allowQaBypass,
        effectiveHumanLock: true,
        reason_code: fetched.errorCode,
      };
      maybeLogPolicyDebug(null, out);
      return out;
    }

    const row = fetched.data;
    if (typeof row.human_only_global !== 'boolean' || typeof row.automation_enabled !== 'boolean') {
      const out = {
        policyResolution: 'error',
        allowAutomatedReply: false,
        allowQaBypass,
        effectiveHumanLock: true,
        reason_code: PERSEO_REASON_CODES.POLICY_SETTINGS_PARSE_INVALID,
      };
      maybeLogPolicyDebug(row, out);
      return out;
    }

    const globalAutomationBlocked = row.human_only_global === true || row.automation_enabled === false;
    const effectiveHumanLock = globalAutomationBlocked || conversationHumanLock;
    const allowAutomatedReply = !globalAutomationBlocked && !conversationHumanLock;

    let reason_code = PERSEO_REASON_CODES.AUTOMATION_ALLOWED;
    if (!allowAutomatedReply) {
      if (conversationHumanLock) reason_code = PERSEO_REASON_CODES.CONVERSATION_HUMAN_ATTENTION;
      else if (row.human_only_global === true) reason_code = PERSEO_REASON_CODES.HUMAN_ONLY_GLOBAL_ACTIVE;
      else if (row.automation_enabled === false) reason_code = PERSEO_REASON_CODES.AUTOMATION_DISABLED_GLOBAL;
    }

    const out = {
      policyResolution: 'ok',
      allowAutomatedReply,
      allowQaBypass,
      effectiveHumanLock,
      reason_code,
    };
    maybeLogPolicyDebug(row, out);
    return out;
  } catch (_err) {
    const out = {
      policyResolution: 'error',
      allowAutomatedReply: false,
      allowQaBypass: isSprint1QaTesterPhone(from),
      effectiveHumanLock: true,
      reason_code: PERSEO_REASON_CODES.POLICY_RESOLUTION_UNEXPECTED,
    };
    maybeLogPolicyDebug(null, out);
    return out;
  }
}

module.exports = {
  PERSEO_REASON_CODES,
  resolveAutomatedReplyPolicy,
  normalizePerseoAiControlFromRow,
  fetchAiConversationChannelSettingsRow,
  isPerseoPolicyV2Enabled,
};
