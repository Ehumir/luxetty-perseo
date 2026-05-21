'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldExplicitlyReopenConversation,
  shouldTreatAsPostCloseAck,
  isTerminalAckClose,
  composeTerminalAckCloseReply,
} = require('../conversation/conversationReopenPolicy');

describe('conversationReopenPolicy', () => {
  const softClosed = { conversation_soft_closed: true };

  it('reopens on explicit commercial intent', () => {
    assert.equal(shouldExplicitlyReopenConversation('También quiero revisar García', softClosed), true);
    assert.equal(shouldExplicitlyReopenConversation('también busco renta', softClosed), true);
  });

  it('does not reopen on acknowledgements', () => {
    assert.equal(shouldExplicitlyReopenConversation('gracias', softClosed), false);
    assert.equal(shouldExplicitlyReopenConversation('ok', softClosed), false);
    assert.equal(shouldExplicitlyReopenConversation('👍', softClosed), false);
    assert.equal(shouldTreatAsPostCloseAck('perfecto'), true);
  });

  it('detects terminal ack close phrases', () => {
    assert.equal(isTerminalAckClose('No, es todo gracias.'), true);
    assert.equal(isTerminalAckClose('nada más'), true);
    assert.equal(isTerminalAckClose('listo gracias'), true);
    assert.equal(isTerminalAckClose('Sería todo'), true);
    assert.equal(isTerminalAckClose('seria todo'), true);
    assert.equal(isTerminalAckClose('eso sería todo'), true);
    assert.equal(isTerminalAckClose('ya sería todo'), true);
    const msg = composeTerminalAckCloseReply({ collectedFields: { fullName: 'Jorge' } });
    assert.match(msg, /Gracias por contactarnos/);
    assert.match(msg, /asesor de Luxetty continuará/i);
    assert.match(msg, /excelente día/i);
  });
});
