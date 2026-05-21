'use strict';

const { evaluateV3CrmExecutionGate } = require('./executionGate');
const {
  buildV3CrmExecutionPayload,
  mapV3StateToLeadAutomationAiState,
} = require('./executionPayload');
const { mergeConversationState } = require('../types/conversationState');
const { v3Log } = require('../core/v3Logger');
const { normalizeText } = require('../../../utils/text');
const { isInvalidContactName } = require('../../../utils/helpers');
const { isCrmExecuteFoundationEnabled } = require('../../../config/perseoM302Flags');
const { isCrmRuntimePersistentEnabled } = require('../../../config/perseoM401Flags');
const { executeV3CrmWithFoundation } = require('./crmExecuteFoundation');
const { executeV3CrmWithRuntime } = require('../runtime/crmRuntime');

/**
 * @param {string} event
 * @param {Record<string, unknown>} payload
 * @param {Function|null} logEvent
 */
function emitCrmLog(event, payload, logEvent) {
  v3Log(event, payload);
  if (typeof logEvent === 'function') {
    logEvent(event, payload);
  }
}

function contactDisplayName(contact) {
  if (!contact || typeof contact !== 'object') return '';
  const joined = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return joined || String(contact.full_name || '').trim();
}

function isConfidentV3FullName(name) {
  const n = String(name || '').trim();
  if (!n || n.length < 2) return false;
  if (isInvalidContactName(n)) return false;
  return true;
}

/**
 * Solo log — no actualiza contacto en F6.1.
 * @param {object} params
 */
async function logContactNameMismatchProposal({
  supabase,
  contactId,
  v3FullName,
  conversationId,
  contactReused,
  logEvent,
}) {
  if (!contactReused || !contactId || !isConfidentV3FullName(v3FullName)) return;
  if (!supabase?.from) return;

  try {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, first_name, last_name, full_name')
      .eq('id', contactId)
      .maybeSingle();
    if (!contact) return;

    const existing = contactDisplayName(contact);
    const incoming = String(v3FullName).trim();
    if (!existing || normalizeText(existing) === normalizeText(incoming)) return;

    emitCrmLog(
      'contact_name_mismatch_proposal',
      {
        conversation_id: conversationId,
        contact_id: contactId,
        existing_contact_name: existing,
        proposed_full_name: incoming,
        action: 'manual_review_or_future_safe_update',
      },
      logEvent,
    );
    emitCrmLog(
      'v3_crm_contact_name_mismatch_proposal',
      {
        conversation_id: conversationId,
        contact_id: contactId,
        existing_contact_name: existing,
        proposed_full_name: incoming,
        action: 'manual_review_or_future_safe_update',
      },
      logEvent,
    );
  } catch (_err) {
    /* no bloquear CRM */
  }
}

/**
 * Ejecuta contacto + lead en ATENA cuando el gate F6 lo permite.
 * @param {{
 *   v3State: import('../types/conversationState').ConversationState,
 *   phone: string,
 *   rawPhone?: string|null,
 *   conversationRow: { id: string, phone?: string|null, contact_id?: string|null, lead_id?: string|null },
 *   supabase: object,
 *   property?: object|null,
 *   propertyId?: string|null,
 *   waProfileName?: string|null,
 *   rawPayload?: object|null,
 *   logEvent?: Function,
 *   ensureContactForConversation?: Function,
 *   createOrReuseLeadFromConversation?: Function,
 *   saveConversationEvent?: Function,
 *   updateConversationMeta?: Function,
 * }} input
 */
async function executeV3CrmIfEligibleImpl(input) {
  const state = input.v3State || {};
  const conversationId = state.conversationId || input.conversationRow?.id;

  const {
    shouldAllowCrmExecuteForInbound,
    logCrmExecuteGate,
  } = require('../../../config/crmExecuteInboundGate');
  const inboundGate = shouldAllowCrmExecuteForInbound({
    phone: input.phone,
    rawPhone: input.rawPhone,
    conversationId,
    v3PrimaryAllowed: true,
    selectedPipeline: 'v3',
    argosMode: input.argosMode === true,
  });
  logCrmExecuteGate(input.logEvent, inboundGate);
  if (!inboundGate.crm_execute_allowed) {
    emitCrmLog(
      'v3_crm_execution_skipped',
      {
        conversation_id: conversationId,
        reason: inboundGate.block_reason || 'crm_execute_inbound_blocked',
      },
      input.logEvent,
    );
    return { executed: false, skipped: true, reason: inboundGate.block_reason, gate: inboundGate };
  }

  const gate = evaluateV3CrmExecutionGate({
    state,
    phone: input.phone,
    rawPhone: input.rawPhone,
  });

  if (!gate.eligible) {
    emitCrmLog(
      'v3_crm_execution_skipped',
      {
        conversation_id: conversationId,
        reason: gate.reason,
        stage: state.conversationStage,
        consent: state.advisorContactConsent,
        crm_payload_ready: state.crmPayloadReady,
      },
      input.logEvent,
    );
    return { v3State: state, executed: false, skipped: true, reason: gate.reason };
  }

  const executionPayload = buildV3CrmExecutionPayload(state, input.phone);
  if (!executionPayload) {
    emitCrmLog(
      'v3_crm_execution_skipped',
      {
        conversation_id: conversationId,
        reason: 'payload_build_failed',
      },
      input.logEvent,
    );
    return { v3State: state, executed: false, skipped: true, reason: 'payload_build_failed' };
  }

  const ensureContact = input.ensureContactForConversation;
  const createLead = input.createOrReuseLeadFromConversation;
  if (typeof ensureContact !== 'function' || typeof createLead !== 'function') {
    emitCrmLog(
      'v3_crm_execution_failed',
      {
        conversation_id: conversationId,
        reason: 'missing_crm_dependencies',
      },
      input.logEvent,
    );
    return { v3State: state, executed: false, failed: true, reason: 'missing_crm_dependencies' };
  }

  emitCrmLog(
    'v3_crm_execution_started',
    {
      conversation_id: conversationId,
      intent: executionPayload.intent,
      conversation_goal: executionPayload.conversation_goal,
      property_code: executionPayload.property_listing_code,
    },
    input.logEvent,
  );

  const aiState = mapV3StateToLeadAutomationAiState(state, executionPayload);
  const persistedAi =
    input.conversationRow?.ai_state && typeof input.conversationRow.ai_state === 'object'
      ? input.conversationRow.ai_state
      : null;
  if (persistedAi?.qa_crm_force_new_lead === true) {
    aiState.qa_crm_force_new_lead = true;
  }
  const propertyId =
    input.propertyId ||
    (state.activeProperty && state.activeProperty.id) ||
    executionPayload.interested_property_id ||
    null;

  const noopEvent = async () => {};
  const saveConversationEvent =
    input.saveConversationEvent ||
    (async (cid, type, payload) => {
      if (input.supabase?.from) {
        try {
          await input.supabase.from('conversation_events').insert({
            conversation_id: cid,
            event_type: type,
            payload,
            created_by: 'ai_agent',
          });
        } catch (_e) {
          /* tests may omit table */
        }
      }
    });

  const updateConversationMeta =
    input.updateConversationMeta ||
    (async (cid, meta) => {
      if (input.supabase?.from && meta && typeof meta === 'object') {
        try {
          await input.supabase.from('conversations').update(meta).eq('id', cid);
        } catch (_e) {
          /* tests may omit */
        }
      }
    });

  try {
    const contactResult = await ensureContact({
      supabase: input.supabase,
      conversationRow: input.conversationRow,
      state: aiState,
      phone: input.phone,
      waName: input.waProfileName || null,
      source: 'whatsapp',
      rawPayload: input.rawPayload || null,
      property: input.property || null,
      logger: console,
      saveConversationEvent,
      updateConversationMeta,
    });
    const contactId = contactResult?.contactId || null;
    const contactWasCreated = !!contactResult?.wasCreated;

    if (!contactId) {
      emitCrmLog(
        'v3_crm_execution_failed',
        {
          conversation_id: conversationId,
          reason: 'contact_not_created',
        },
        input.logEvent,
      );
      return {
        v3State: mergeConversationState(state, {
          crmExecutionStatus: 'failed',
          crmExecutionError: 'contact_not_created',
        }),
        executed: false,
        failed: true,
        reason: 'contact_not_created',
      };
    }

    const contactReused = !!input.conversationRow?.contact_id;
    emitCrmLog(
      contactReused ? 'v3_crm_contact_reused' : 'v3_crm_contact_created',
      { conversation_id: conversationId, contact_id: contactId },
      input.logEvent,
    );

    const v3FullName = state.collectedFields?.fullName || aiState?.full_name || null;
    await logContactNameMismatchProposal({
      supabase: input.supabase,
      contactId,
      v3FullName,
      conversationId,
      contactReused,
      logEvent: input.logEvent,
    });

    const leadResult = await createLead({
      supabase: input.supabase,
      conversation: input.conversationRow,
      aiState,
      contactId,
      propertyId: propertyId || null,
      property: input.property || null,
      contactWasCreated,
      logger: console,
    });

    if (!leadResult?.success) {
      emitCrmLog(
        'v3_crm_execution_failed',
        {
          conversation_id: conversationId,
          contact_id: contactId,
          reason: leadResult?.reason || 'lead_create_failed',
        },
        input.logEvent,
      );
      return {
        v3State: mergeConversationState(state, {
          crmExecutionStatus: 'failed',
          crmContactId: contactId,
          crmExecutionError: leadResult?.reason || 'lead_create_failed',
        }),
        executed: false,
        failed: true,
        reason: leadResult?.reason || 'lead_create_failed',
        contactId,
        leadResult,
      };
    }

    const leadId = leadResult.leadId || leadResult.lead?.id || null;
    emitCrmLog(
      leadResult.wasCreated ? 'v3_crm_lead_created' : 'v3_crm_lead_reused',
      {
        conversation_id: conversationId,
        contact_id: contactId,
        lead_id: leadId,
        was_created: !!leadResult.wasCreated,
      },
      input.logEvent,
    );

    if (leadId && input.conversationRow?.lead_id !== leadId) {
      await updateConversationMeta(conversationId, { lead_id: leadId });
    }

    const nextState = mergeConversationState(state, {
      crmExecutionCompleted: true,
      crmExecutionStatus: 'completed',
      crmContactId: contactId,
      crmLeadId: leadId,
      crmExecutedAt: new Date().toISOString(),
      hasContact: true,
    });

    return {
      v3State: nextState,
      executed: true,
      contactId,
      leadId,
      leadResult,
      executionPayload,
    };
  } catch (err) {
    emitCrmLog(
      'v3_crm_execution_failed',
      {
        conversation_id: conversationId,
        error: String(err && err.message ? err.message : err),
      },
      input.logEvent,
    );
    return {
      v3State: mergeConversationState(state, {
        crmExecutionStatus: 'failed',
        crmExecutionError: String(err && err.message ? err.message : err),
      }),
      executed: false,
      failed: true,
      reason: 'exception',
    };
  }
}

async function executeV3CrmIfEligible(input) {
  const enriched = {
    ...input,
    argosMode: input.argosMode === true,
    crmDryRun: input.crmDryRun !== false,
  };
  if (isCrmRuntimePersistentEnabled()) {
    return executeV3CrmWithRuntime(enriched, executeV3CrmIfEligibleImpl);
  }
  if (isCrmExecuteFoundationEnabled()) {
    return executeV3CrmWithFoundation(enriched, executeV3CrmIfEligibleImpl);
  }
  return executeV3CrmIfEligibleImpl(enriched);
}

module.exports = {
  executeV3CrmIfEligible,
  executeV3CrmIfEligibleImpl,
};
