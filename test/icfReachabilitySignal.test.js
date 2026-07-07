'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mapReachabilitySignal } = require('../conversation/v3/cos/icfReachabilitySignal');

describe('icfReachabilitySignal', () => {
  it('maps positive sell intent', () => {
    assert.equal(
      mapReachabilitySignal({ detectedIntent: 'sell', userText: 'quiero vender mi casa', inbound: true }),
      'intent_positive',
    );
  });

  it('maps deferred replies', () => {
    assert.equal(
      mapReachabilitySignal({ detectedIntent: 'unknown', userText: 'después hablamos', inbound: true }),
      'client_deferred',
    );
  });

  it('ignores outbound messages', () => {
    assert.equal(
      mapReachabilitySignal({ detectedIntent: 'sell', userText: 'hola', inbound: false }),
      null,
    );
  });
});
