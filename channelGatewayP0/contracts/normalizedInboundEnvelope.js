'use strict';

/**
 * Contrato canónico ACC P0 — mensaje inbound normalizado (pre-PERSEO).
 * @see docs/architecture/APA_ACC_RAG_P0_6_SPRINTS.md
 */

/** @typedef {'whatsapp'|'facebook'|'instagram'} AccConnectorCode */

/**
 * @typedef {Object} NormalizedInboundAttachment
 * @property {'image'|'audio'|'video'|'document'|'sticker'|'unknown'} type
 * @property {string} [mime_type]
 * @property {string} [external_media_id]
 * @property {string} [url]
 * @property {string} [caption]
 */

/**
 * @typedef {Object} NormalizedInboundEnvelope
 * @property {string} envelope_version — siempre '1' en P0
 * @property {AccConnectorCode} connector_code
 * @property {string} external_message_id — dedupe key por canal
 * @property {string} external_conversation_id — thread id Meta
 * @property {string} external_sender_id — phone E.164, PSID o IGSID
 * @property {string} [sender_display_name]
 * @property {'text'|'image'|'audio'|'video'|'document'|'sticker'|'location'|'unknown'} message_type
 * @property {string} [text]
 * @property {NormalizedInboundAttachment[]} [attachments]
 * @property {string} received_at — ISO8601
 * @property {Record<string, unknown>} [raw_meta] — sin tokens; solo ids útiles
 */

/**
 * @typedef {Object} NormalizedConversationTurn
 * @property {string} turn_version — '1' en P0
 * @property {NormalizedInboundEnvelope} inbound
 * @property {string} [conversation_id] — UUID interno si ya resuelto
 * @property {string} [channel] — redundante con connector_code
 */

const ENVELOPE_VERSION = '1';
const TURN_VERSION = '1';

const VALID_CONNECTORS = new Set(['whatsapp', 'facebook', 'instagram']);

/**
 * @param {Partial<NormalizedInboundEnvelope>} input
 * @returns {NormalizedInboundEnvelope}
 */
function buildNormalizedInboundEnvelope(input) {
  const connector = String(input.connector_code || '').trim().toLowerCase();
  if (!VALID_CONNECTORS.has(connector)) {
    throw new Error(`invalid_connector_code:${connector || 'empty'}`);
  }
  const externalMessageId = String(input.external_message_id || '').trim();
  const externalSenderId = String(input.external_sender_id || '').trim();
  if (!externalMessageId || !externalSenderId) {
    throw new Error('missing_external_ids');
  }

  return {
    envelope_version: ENVELOPE_VERSION,
    connector_code: /** @type {AccConnectorCode} */ (connector),
    external_message_id: externalMessageId,
    external_conversation_id: String(input.external_conversation_id || externalSenderId).trim(),
    external_sender_id: externalSenderId,
    sender_display_name: input.sender_display_name ? String(input.sender_display_name) : undefined,
    message_type: input.message_type || 'text',
    text: input.text != null ? String(input.text) : undefined,
    attachments: Array.isArray(input.attachments) ? input.attachments : undefined,
    received_at: input.received_at || new Date().toISOString(),
    raw_meta: input.raw_meta && typeof input.raw_meta === 'object' ? input.raw_meta : undefined,
  };
}

/**
 * @param {NormalizedInboundEnvelope} envelope
 * @param {{ conversation_id?: string }} [ctx]
 * @returns {NormalizedConversationTurn}
 */
function toNormalizedConversationTurn(envelope, ctx = {}) {
  return {
    turn_version: TURN_VERSION,
    inbound: envelope,
    conversation_id: ctx.conversation_id || undefined,
    channel: envelope.connector_code,
  };
}

/**
 * @param {unknown} value
 * @returns {value is NormalizedInboundEnvelope}
 */
function isNormalizedInboundEnvelope(value) {
  if (!value || typeof value !== 'object') return false;
  const v = /** @type {Record<string, unknown>} */ (value);
  return (
    v.envelope_version === ENVELOPE_VERSION &&
    typeof v.connector_code === 'string' &&
    VALID_CONNECTORS.has(v.connector_code) &&
    typeof v.external_message_id === 'string' &&
    typeof v.external_sender_id === 'string'
  );
}

module.exports = {
  ENVELOPE_VERSION,
  TURN_VERSION,
  VALID_CONNECTORS,
  buildNormalizedInboundEnvelope,
  toNormalizedConversationTurn,
  isNormalizedInboundEnvelope,
};
