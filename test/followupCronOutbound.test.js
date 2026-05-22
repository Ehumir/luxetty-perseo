'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sendPerseoAutomatedWhatsApp } = require('../services/perseoAutomatedWhatsApp');
const { getNextDueAction } = require('../services/followupAutomation');

describe('followup cron outbound hotfix', () => {
  it('sendPerseoAutomatedWhatsApp does not throw when saveOutboundMessages returns undefined', async () => {
    let graphCalls = 0;
    const axios = require('axios');
    const originalPost = axios.post;
    axios.post = async (...args) => {
      if (String(args[0] || '').includes('graph.facebook.com')) {
        graphCalls += 1;
        return { data: { messages: [{ id: 'wamid.test' }] } };
      }
      return originalPost(...args);
    };

    try {
      const result = await sendPerseoAutomatedWhatsApp({
        channel: 'ia',
        to: '5218100000001',
        messages: ['¿Deseas continuar?'],
        conversationId: 'conv-cron-test',
        policy: { allowAutomatedReply: true, reason_code: 'cron_followup' },
        saveOutboundMessages: async () => {},
        saveConversationEvent: async () => {},
        logEvent: () => {},
      });

      assert.equal(result.sent, true);
      assert.deepEqual(result.outbound, ['¿Deseas continuar?']);
      assert.deepEqual(result.rows, []);
      assert.equal(graphCalls, 1);
    } finally {
      axios.post = originalPost;
    }
  });

  it('getNextDueAction unchanged after outbound persist contract (no duplicate step)', () => {
    const now = new Date();
    const hoursAgo = (h) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
    const action = getNextDueAction({
      messages: [
        { direction: 'inbound', sender_type: 'lead', created_at: hoursAgo(2) },
        { direction: 'outbound', sender_type: 'ai_agent', created_at: hoursAgo(1.9) },
      ],
      sentEvents: new Set(),
      now,
    });
    assert.equal(action?.step?.key, '1h');
  });
});
