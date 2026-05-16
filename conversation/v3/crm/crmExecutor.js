'use strict';

const { evaluateV3CrmExecutionGate } = require('./executionGate');
const {
  buildV3CrmExecutionPayload,
  mapV3StateToLeadAutomationAiState,
} = require('./executionPayload');
const { mergeConversationState } = require('../types/conversationState');
const { v3Log } = require('../core/v3Logger');

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
async function executeV3CrmIfEligible(input) {
  const state = input.v3State || {};
  const conversationId = state.conversationId || input.conversationRow?.id;
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
    const contactId = await ensureContact({
      supabase: input.supabase,
      conversationRow: input.conversationRow,
      state: aiState,
      phone: input.phone,
      waName: input.waProfileName || null,
      source: 'whatsapp',
      rawPayload: input.rawPayload || null,
      saveConversationEvent,
      updateConversationMeta,
    });

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

    const leadResult = await createLead({
      supabase: input.supabase,
      conversation: input.conversationRow,
      aiState,
      contactId,
      propertyId: propertyId || null,
      property: input.property || null,
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

module.exports = {
  executeV3CrmIfEligible,
};
