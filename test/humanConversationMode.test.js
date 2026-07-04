'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const humanEscalation = require('../conversation/humanEscalation');
const conversationMode = require('../conversation/conversationMode');
const { getDefaultAiState } = require('../conversation/aiState');

describe('humanConversationMode', () => {
  it('detecta no máquina y asesor personal', () => {
    assert.equal(humanEscalation.isExplicitHumanAdvisorRequest('Asesor personal'), true);
    assert.equal(humanEscalation.isExplicitHumanAdvisorRequest('No máquina'), true);
    assert.equal(humanEscalation.isBotRejectionText('No máquina'), true);
    assert.equal(humanEscalation.isExplicitHumanAdvisorRequest('busco casa'), false);
  });

  it('asesor personal hace handoff y mode HUMAN', () => {
    const turn = humanEscalation.resolveWantsHumanEscalationTurn({
      previousAiState: getDefaultAiState(),
      nextAiState: getDefaultAiState(),
      parsedSignals: {},
      text: 'Asesor personal',
    });
    assert.equal(turn.handled, true);
    assert.ok(turn.reply);
    assert.equal(turn.statePatch.handoff_sent, true);
    assert.equal(turn.statePatch.conversation_mode, conversationMode.CONVERSATION_MODES.HUMAN);
    assert.equal(turn.skipSend, undefined);
  });

  it('no máquina tras handoff es silencio', () => {
    const prev = {
      ...getDefaultAiState(),
      handoff_sent: true,
      wants_human: true,
      conversation_mode: 'HUMAN',
      post_handoff_hold_sent: true,
    };
    const turn = humanEscalation.resolveWantsHumanEscalationTurn({
      previousAiState: prev,
      nextAiState: prev,
      parsedSignals: {},
      text: 'No máquina',
    });
    assert.equal(turn.handled, true);
    assert.equal(turn.skipSend, true);
    assert.ok(!turn.reply);
  });

  it('mode gate bloquea advisor en HUMAN', () => {
    const gate = conversationMode.evaluateConversationModeGate({
      previousAiState: { handoff_sent: true, conversation_mode: 'HUMAN' },
      nextAiState: { handoff_sent: true, conversation_mode: 'HUMAN' },
      text: 'hola otra vez',
    });
    assert.equal(gate.blocked, true);
  });
});
