'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  tryResolveClosureIntegrityTurn,
  buildConsentAcceptedClosurePatch,
  isExplicitCommercialReopen,
  isLegacySearchReopenReply,
  composeConsentAcceptedMessage,
} = require('../conversation/v3/runtime/closureIntegrity');

describe('closureIntegrity M4-04D', () => {
  it('consent accepted message includes algo más', () => {
    const msg = composeConsentAcceptedMessage({ collectedFields: { fullName: 'Jorge' } });
    assert.match(msg, /asesor de Luxetty/);
    assert.match(msg, /algo más/);
  });

  it('buildConsentAcceptedClosurePatch sets waiting confirmation without forcing CRM', () => {
    const patch = buildConsentAcceptedClosurePatch();
    assert.equal(patch.handoffWaitingFinalConfirmation, true);
    assert.equal(patch.conversationSoftClosed, false);
    assert.ok(patch.handoffCompletedAt);
    assert.equal(patch.qualificationComplete, undefined);
  });

  it('gracias after waiting closes with terminal ack', () => {
    const state = {
      handoffWaitingFinalConfirmation: true,
      softClosePending: true,
      advisorContactConsent: 'ACCEPTED',
      conversationSoftClosed: false,
      collectedFields: { fullName: 'Jorge' },
    };
    const out = tryResolveClosureIntegrityTurn({ state, text: 'Gracias' });
    assert.equal(out.handled, true);
    assert.equal(out.statePatch.conversationSoftClosed, true);
    assert.equal(out.statePatch.terminalAckClose, true);
    assert.match(out.reply, /Gracias por contactarnos/);
    assert.doesNotMatch(out.reply, /algo más en lo que te pueda ayudar/i);
  });

  it('no es todo gracias does not ask before close again', () => {
    const state = {
      handoffWaitingFinalConfirmation: true,
      softClosePending: true,
      advisorContactConsent: 'ACCEPTED',
      collectedFields: { fullName: 'Jorge' },
    };
    const out = tryResolveClosureIntegrityTurn({ state, text: 'No, es todo gracias.' });
    assert.equal(out.responseSource, 'v3_closure_terminal_ack_close');
    assert.doesNotMatch(out.reply, /algo más en lo que te pueda ayudar/i);
  });

  it('explicit reopen after soft close', () => {
    const state = {
      conversationSoftClosed: true,
      locationText: 'Cumbres',
      collectedFields: { fullName: 'Jorge' },
    };
    assert.equal(isExplicitCommercialReopen('También quiero revisar García'), true);
    const out = tryResolveClosureIntegrityTurn({ state, text: 'También quiero revisar García' });
    assert.equal(out.handled, true);
    assert.equal(out.statePatch.explicitReopen, true);
    assert.match(out.reply, /comprar o rentar/i);
  });

  it('detects legacy search reopen copy', () => {
    assert.equal(isLegacySearchReopenReply('Seguimos con tu búsqueda de compra.'), true);
    assert.equal(isLegacySearchReopenReply('Con gusto. Si más adelante necesitas revisar opciones'), false);
  });
});
