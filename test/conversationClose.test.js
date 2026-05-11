const test = require('node:test');
const assert = require('node:assert/strict');

const { applyCommercialClose } = require('../conversation/conversationClose');

test('commercial_close_triggered deja conversación en status closed', async () => {
  const events = [];
  let updatedPayload = null;
  const conversationRow = { id: 'conv-1', status: 'open' };

  const result = await applyCommercialClose({
    conversationId: 'conv-1',
    conversationRow,
    closeReason: 'seller_context_close',
    saveConversationEvent: async (_id, type, payload) => events.push({ type, payload }),
    updateConversationMeta: async (_id, payload) => {
      updatedPayload = payload;
    },
    nowIso: () => '2026-05-11T00:00:00.000Z',
  });

  assert.equal(result.closed, true);
  assert.equal(conversationRow.status, 'closed');
  assert.equal(updatedPayload.status, 'closed');
  assert.ok(events.some((entry) => entry.type === 'CONVERSATION_CLOSE_ATTEMPT'));
  assert.ok(events.some((entry) => entry.type === 'CONVERSATION_CLOSE_SUCCESS'));
});
