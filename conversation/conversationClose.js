'use strict';

async function applyCommercialClose({
  conversationId,
  conversationRow = {},
  closeReason = 'commercial_close',
  saveConversationEvent,
  updateConversationMeta,
  nowIso,
}) {
  await saveConversationEvent(conversationId, 'CONVERSATION_CLOSE_ATTEMPT', {
    reason: closeReason,
    source: 'ai_agent',
  });

  try {
    if (conversationRow?.status === 'closed') {
      await saveConversationEvent(conversationId, 'CONVERSATION_CLOSE_SKIPPED', {
        reason: 'already_closed',
        source: 'ai_agent',
      });
      return { closed: false, skipped: true };
    }

    await updateConversationMeta(conversationId, {
      status: 'closed',
      follow_up_status: 'done',
      updated_at: nowIso(),
    });
    conversationRow.status = 'closed';

    await saveConversationEvent(conversationId, 'CONVERSATION_CLOSE_SUCCESS', {
      reason: closeReason,
      source: 'ai_agent',
    });
    return { closed: true, skipped: false };
  } catch (error) {
    await saveConversationEvent(conversationId, 'CONVERSATION_CLOSE_FAILED', {
      reason: closeReason,
      source: 'ai_agent',
      error: error?.message || String(error),
    });
    return { closed: false, skipped: false, error };
  }
}

module.exports = {
  applyCommercialClose,
};
