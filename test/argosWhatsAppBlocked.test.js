'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sendPerseoAutomatedWhatsApp } = require('../services/perseoAutomatedWhatsApp');

describe('argosWhatsAppBlocked', () => {
  it('throws ARGOS_WHATSAPP_BLOCKED when argosMode is true', async () => {
    await assert.rejects(
      () =>
        sendPerseoAutomatedWhatsApp({
          channel: 'ia',
          to: '5218100000001',
          messages: ['hola'],
          conversationId: 'argos:test',
          policy: { allowAutomatedReply: true },
          saveOutboundMessages: async () => ({ outbound: [], rows: [] }),
          argosMode: true,
        }),
      (err) => err.code === 'ARGOS_WHATSAPP_BLOCKED',
    );
  });
});
