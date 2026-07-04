'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveConversationOpening } = require('../conversation/conversationOpeningResolver');
const humanEscalation = require('../conversation/humanEscalation');
const antiLoop = require('../conversation/antiLoopGuardrails');
const { getDefaultAiState } = require('../conversation/aiState');
const { findForbiddenOpeningSnippet } = require('../conversation/contracts/conversationOpeningContract');

describe('Juan José narrative', () => {
  it('saludo → meta → asesor → no máquina (silencio)', () => {
    let st = getDefaultAiState();
    let recent = [];

    let opening = resolveConversationOpening({
      text: 'Hola 👋 buenas tardes',
      previousAiState: st,
      nextAiState: st,
      parsedSignals: {},
      recentMessages: recent,
    });
    assert.equal(opening.handled, true);
    assert.equal(findForbiddenOpeningSnippet(opening.reply), null);
    Object.assign(st, opening.statePatch);
    recent.push({ direction: 'inbound' }, { direction: 'outbound' });

    // Anti-loop no debe disculparse ante Facebook
    const fbReply = 'Gracias por escribirnos. ¿Vienes por alguna propiedad en particular o prefieres hablar con un asesor?';
    const fbLoop = antiLoop.applyFallbackStreakRecovery(fbReply, {
      nextAiState: {
        ...st,
        anti_loop_last_fallback_bucket: 'generic_tail',
        anti_loop_fallback_streak: 1,
        anti_loop_last_inbound_short_intent: 'greeting_hola',
      },
      text: 'Estoy navegando en facebook y Vi su página inmobiliaria 👍',
      contact: null,
      waProfileName: 'Juan',
    });
    assert.doesNotMatch(String(fbLoop.reply), /Perdona si se sintió repetido/i);

    opening = resolveConversationOpening({
      text: 'Estoy navegando en facebook y Vi su página inmobiliaria 👍',
      previousAiState: st,
      nextAiState: st,
      parsedSignals: {},
      recentMessages: recent,
    });
    assert.equal(opening.handled, true);
    assert.equal(opening.opening_type, 'meta_general');
    Object.assign(st, opening.statePatch);

    const handoff = humanEscalation.resolveWantsHumanEscalationTurn({
      previousAiState: st,
      nextAiState: st,
      parsedSignals: {},
      text: 'Asesor personal',
    });
    assert.equal(handoff.handled, true);
    assert.ok(handoff.reply);
    Object.assign(st, handoff.statePatch);

    const silence = humanEscalation.resolveWantsHumanEscalationTurn({
      previousAiState: st,
      nextAiState: st,
      parsedSignals: {},
      text: 'No máquina',
    });
    assert.equal(silence.handled, true);
    assert.equal(silence.skipSend, true);
    assert.ok(!silence.reply);
  });
});
