'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldExplicitlyReopenConversation,
  shouldTreatAsPostCloseAck,
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
});
