'use strict';

/**
 * Sprint 2 — Wrapper outbound obligatorio (WhatsApp Graph /messages).
 *
 * Toda respuesta automatizada del webhook PERSEO debe salir por `sendPerseoAutomatedWhatsApp`.
 * No añadir `axios.post(.../messages)` en otros módulos de runtime; validar con:
 *   npm run validate:graph-outbound
 *
 * Los jobs de inactividad / smoke scripts inyectan su propio transporte y quedan fuera
 * de este contrato hasta un sprint dedicado.
 */

const axios = require('axios');
const { WHATSAPP_TOKEN, PHONE_NUMBER_ID, GRAPH_API_VERSION } = require('../config/env');
const { normalizeOutboundMessages } = require('../utils/helpers');
const { PERSEO_REASON_CODES } = require('../conversation/perseoGatekeeper');

const EVENT_AUTOMATION_BLOCKED = 'ai_auto_response_skipped_human_attention';

function graphApiVersionPath() {
  const v = GRAPH_API_VERSION || 'v19.0';
  return v.startsWith('v') ? v : `v${v}`;
}

/** Único axios.post hacia Graph messages en el path webhook PERSEO. */
async function graphPostWhatsAppText(to, body) {
  const version = graphApiVersionPath();
  return axios.post(
    `https://graph.facebook.com/${version}/${PHONE_NUMBER_ID}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body } },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * @param {object} args
 * @param {'ia'|'qa'} args.channel
 * @param {string} args.to
 * @param {string|string[]|null|undefined} args.messages
 * @param {string|null} args.conversationId
 * @param {object} [args.rawPayload]
 * @param {import('../conversation/perseoGatekeeper').AutomatedReplyPolicy} args.policy
 * @param {function} args.saveOutboundMessages — misma firma que en index.js
 * @param {function} [args.saveConversationEvent]
 * @param {function} [args.logEvent]
 */
async function sendPerseoAutomatedWhatsApp({
  channel,
  to,
  messages,
  conversationId,
  rawPayload = {},
  policy,
  saveOutboundMessages,
  saveConversationEvent,
  logEvent,
  argosMode = false,
}) {
  if (argosMode === true || rawPayload?.argosMode === true || policy?.argosMode === true) {
    const err = new Error('ARGOS_WHATSAPP_BLOCKED');
    err.code = 'ARGOS_WHATSAPP_BLOCKED';
    if (typeof logEvent === 'function') {
      logEvent('argos_whatsapp_blocked', {
        conversation_id: conversationId,
        channel,
        reason: 'argos_mode',
      });
    }
    throw err;
  }

  const outbound = normalizeOutboundMessages(messages);
  if (!outbound.length) {
    return { sent: false, reason_code: PERSEO_REASON_CODES.OUTBOUND_MESSAGES_EMPTY };
  }

  if (channel === 'ia' && !policy.allowAutomatedReply) {
    if (typeof logEvent === 'function') {
      logEvent('perseo_automation_blocked', {
        conversation_id: conversationId,
        reason_code: policy.reason_code,
        policy_resolution: policy.policyResolution,
        channel: 'ia',
      });
    }
    if (typeof saveConversationEvent === 'function') {
      await saveConversationEvent(conversationId, EVENT_AUTOMATION_BLOCKED, {
        reason_code: policy.reason_code,
        policy_resolution: policy.policyResolution,
        channel: 'ia',
        via: 'outbound_wrapper',
      });
    }
    return { sent: false, reason_code: policy.reason_code };
  }

  if (channel === 'qa' && !policy.allowQaBypass) {
    if (typeof logEvent === 'function') {
      logEvent('perseo_qa_outbound_denied', {
        conversation_id: conversationId,
        reason_code: PERSEO_REASON_CODES.QA_OUTBOUND_NOT_ALLOWLISTED,
      });
    }
    if (typeof saveConversationEvent === 'function') {
      await saveConversationEvent(conversationId, 'qa_outbound_denied_not_allowlist', {
        conversation_id: conversationId,
      });
    }
    return { sent: false, reason_code: PERSEO_REASON_CODES.QA_OUTBOUND_NOT_ALLOWLISTED };
  }

  const persisted = await saveOutboundMessages({
    conversationId,
    messages: outbound,
    rawPayload,
  });

  if (typeof logEvent === 'function') {
    logEvent('perseo_outbound_wrapper_persisted', {
      conversation_id: conversationId,
      channel,
      fragments: outbound.length,
    });
  }

  for (const body of outbound) {
    await graphPostWhatsAppText(to, body);
  }

  if (typeof logEvent === 'function') {
    logEvent('perseo_wrapper_outbound_sent', {
      conversation_id: conversationId,
      channel,
      fragments: outbound.length,
    });
  }

  return { sent: true, outbound: persisted.outbound, rows: persisted.rows };
}

module.exports = {
  sendPerseoAutomatedWhatsApp,
  graphPostWhatsAppText,
};
