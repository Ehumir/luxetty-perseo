'use strict';

const { getPerseoV3Config, isPhoneOnV3Allowlist, normalizeInboundPhoneForV3 } = require('../../../config/perseoV3Flags');
const { mergeConversationState } = require('../types/conversationState');
const { v3Log } = require('../core/v3Logger');

const REPLY_RESETCRM_OK =
  'Listo, desvinculé los vínculos CRM de esta conversación (QA). Podés volver a probar el flujo completo.';
const REPLY_RESETCRM_SKIPPED_PREFIX = 'No se pudo ejecutar !resetcrm:';

/** Campos legacy `ai_state` ligados a CRM / reuse de lead. */
const CRM_AI_STATE_KEYS = [
  'lead_id',
  'crm_lead_id',
  'crm_contact_id',
  'crm_execution_completed',
  'crm_payload_ready',
  'crm_executed_at',
  'crm_execution_status',
  'crm_execution_error',
  'crm_payload_preview',
  'perseo_v3_execution_payload',
  'v3_crm_source',
];

/** Campos V3 in-memory que fuerzan reuse o bloquean nueva ejecución F6. */
const CRM_V3_SESSION_KEYS = [
  'crmExecutionCompleted',
  'crmExecutionStatus',
  'crmContactId',
  'crmLeadId',
  'crmExecutedAt',
  'crmExecutionError',
  'crmPayloadReady',
  'crmPayloadPreview',
];

/**
 * @param {{ phone?: string|null, qaCommandsAllowed?: boolean }} input
 */
function evaluateQaCrmResetGate(input) {
  const cfg = getPerseoV3Config();
  const phone = normalizeInboundPhoneForV3(input?.phone || '');
  const qaCommandsAllowed = input?.qaCommandsAllowed !== false;

  if (!cfg.crmExecute) {
    return { allowed: false, reason: 'crm_execute_disabled', phone };
  }
  if (!qaCommandsAllowed) {
    return { allowed: false, reason: 'qa_commands_not_allowed', phone };
  }
  if (!phone) {
    return { allowed: false, reason: 'phone_unnormalizable', phone: null };
  }
  if (!isPhoneOnV3Allowlist(phone)) {
    return { allowed: false, reason: 'allowlist_no_match', phone };
  }

  return { allowed: true, reason: null, phone };
}

/**
 * @param {Record<string, unknown>|null|undefined} aiState
 */
function stripCrmFieldsFromAiState(aiState) {
  const base = aiState && typeof aiState === 'object' && !Array.isArray(aiState) ? { ...aiState } : {};
  for (const key of CRM_AI_STATE_KEYS) {
    if (key in base) {
      if (key === 'crm_payload_ready' || key === 'crm_execution_completed') {
        base[key] = false;
      } else {
        base[key] = null;
      }
    }
  }
  return base;
}

/**
 * @param {import('../types/conversationState').ConversationState|null} session
 */
function stripCrmFieldsFromV3Session(session) {
  if (!session || typeof session !== 'object') return null;
  /** @type {Record<string, unknown>} */
  const patch = {};
  for (const key of CRM_V3_SESSION_KEYS) {
    if (key === 'crmPayloadReady' || key === 'crmExecutionCompleted') {
      patch[key] = false;
    } else if (key === 'crmPayloadPreview') {
      patch[key] = null;
    } else {
      patch[key] = null;
    }
  }
  return mergeConversationState(session, patch);
}

function emitQaCrmResetLog(event, payload, logEvent) {
  v3Log(event, payload);
  console.log(event, payload);
  if (typeof logEvent === 'function') {
    logEvent(event, payload);
  }
}

/**
 * Desvincula vínculos CRM de la conversación actual (QA only). No borra leads ni contactos.
 * @param {{
 *   phone: string,
 *   conversationId: string,
 *   conversationRow?: object,
 *   qaCommandsAllowed?: boolean,
 *   saveStateFn: (id: string, state: object) => Promise<void>,
 *   updateConversationFn?: (client: object, id: string, payload: object) => Promise<void>,
 *   supabase?: object,
 *   normalizeAiState?: (s: object) => object,
 *   getV3Session?: (id: string) => object|null,
 *   setV3Session?: (id: string, state: object) => void,
 *   saveEventFn?: (id: string, type: string, payload: object) => Promise<void>,
 *   nowIso?: () => string,
 *   logEvent?: Function,
 * }} deps
 */
async function executeQaCrmReset(deps) {
  const {
    phone,
    conversationId,
    conversationRow = {},
    saveStateFn,
    updateConversationFn,
    supabase,
    normalizeAiState,
    getV3Session,
    setV3Session,
    saveEventFn,
    nowIso = () => new Date().toISOString(),
    logEvent,
  } = deps;

  const gate = evaluateQaCrmResetGate({
    phone,
    qaCommandsAllowed: deps.qaCommandsAllowed,
  });

  const auditBase = {
    conversation_id: conversationId,
    phone_normalized: gate.phone || null,
    previous_lead_id: conversationRow?.lead_id || null,
    ts: nowIso(),
  };

  emitQaCrmResetLog('qa_crm_reset_started', auditBase, logEvent);

  if (!gate.allowed) {
    const skipped = { ...auditBase, reason: gate.reason };
    emitQaCrmResetLog('qa_crm_reset_skipped', skipped, logEvent);
    if (saveEventFn) {
      await saveEventFn(conversationId, 'qa_crm_reset_skipped', skipped);
    }
    return {
      ok: false,
      skipped: true,
      reason: gate.reason,
      message: `${REPLY_RESETCRM_SKIPPED_PREFIX} ${gate.reason}`,
    };
  }

  const previousLeadId = conversationRow?.lead_id || null;
  const previousContactId = conversationRow?.contact_id || null;

  const rawAi = conversationRow?.ai_state || {};
  const stripped = stripCrmFieldsFromAiState(rawAi);
  stripped.qa_crm_force_new_lead = true;
  const nextAi =
    typeof normalizeAiState === 'function' ? normalizeAiState(stripped) : stripped;

  await saveStateFn(conversationId, nextAi);

  if (updateConversationFn && supabase) {
    await updateConversationFn(supabase, conversationId, {
      lead_id: null,
      updated_at: nowIso(),
    });
  }

  let v3Cleared = false;
  if (typeof getV3Session === 'function' && typeof setV3Session === 'function') {
    const session = getV3Session(conversationId);
    if (session) {
      setV3Session(conversationId, stripCrmFieldsFromV3Session(session));
      v3Cleared = true;
    }
  }

  const completed = {
    ...auditBase,
    previous_lead_id: previousLeadId,
    previous_contact_id: previousContactId,
    contact_id_preserved: previousContactId,
    v3_session_cleared: v3Cleared,
    lead_id_cleared: true,
  };

  emitQaCrmResetLog('qa_crm_reset_completed', completed, logEvent);
  if (saveEventFn) {
    await saveEventFn(conversationId, 'qa_crm_reset_completed', completed);
  }

  return {
    ok: true,
    skipped: false,
    message: REPLY_RESETCRM_OK,
    nextAiState: nextAi,
    conversationUpdate: { lead_id: null },
  };
}

module.exports = {
  evaluateQaCrmResetGate,
  stripCrmFieldsFromAiState,
  stripCrmFieldsFromV3Session,
  executeQaCrmReset,
  REPLY_RESETCRM_OK,
  CRM_AI_STATE_KEYS,
  CRM_V3_SESSION_KEYS,
};
