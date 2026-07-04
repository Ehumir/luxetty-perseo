'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertOpeningReplyAllowed,
  enforceOpeningContract,
  findForbiddenOpeningSnippet,
} = require('../conversation/contracts/conversationOpeningContract');
const { resolveConversationOpening } = require('../conversation/conversationOpeningResolver');
const { getDefaultAiState } = require('../conversation/aiState');

describe('conversationOpeningContract', () => {
  it('detecta snippets robotizados prohibidos', () => {
    assert.ok(findForbiddenOpeningSnippet('Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.'));
    assert.ok(findForbiddenOpeningSnippet('¿Qué buscas?'));
  });

  it('bloquea primer mensaje robotizado en hilo frío', () => {
    const check = assertOpeningReplyAllowed(
      'Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.',
      { aiState: getDefaultAiState(), opening_type: 'greeting' },
    );
    assert.equal(check.allowed, false);
    assert.match(check.safeReply, /Luxetty/i);
  });

  it('saludo no usa frases prohibidas', () => {
    const opening = resolveConversationOpening({
      text: 'Hola 👋 buenas tardes',
      previousAiState: getDefaultAiState(),
      nextAiState: getDefaultAiState(),
      parsedSignals: {},
      recentMessages: [],
    });
    assert.equal(opening.handled, true);
    assert.equal(opening.opening_type, 'greeting');
    assert.equal(findForbiddenOpeningSnippet(opening.reply), null);
    assert.doesNotMatch(String(opening.reply), /dime un poco más|qué buscas|te oriento/i);
  });

  it('enforceOpeningContract sustituye genérico', () => {
    const out = enforceOpeningContract('Claro, te ayudo. Dime un poco más de lo que buscas y te oriento.', {
      aiState: getDefaultAiState(),
      opening_type: 'meta_general',
    });
    assert.equal(out.enforced, true);
    assert.match(out.reply, /asesor|propiedad/i);
  });
});
