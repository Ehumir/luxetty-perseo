'use strict';

const { normalizeOutboundMessages } = require('../utils/helpers');
const { saveConversationMessage } = require('./saveConversationMessage');

/**
 * Persist outbound fragments before Graph send (same contract as index.js webhook).
 */
async function saveOutboundMessages(supabase, { conversationId, messages, rawPayload = {} }) {
  const outbound = normalizeOutboundMessages(messages);
  const rows = [];
  for (const messageText of outbound) {
    const row = await saveConversationMessage(supabase, {
      conversationId,
      direction: 'outbound',
      senderType: 'ai_agent',
      messageType: 'text',
      messageText,
      rawPayload,
    });
    if (row?.id) rows.push(row);
  }
  return { outbound, rows };
}

module.exports = {
  saveOutboundMessages,
};
