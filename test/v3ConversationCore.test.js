'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  createInitialConversationState,
  interpretUserTextMock,
  applyV3StateTransition,
  CONVERSATION_STAGES,
  evaluateRuleGuard,
  createEmptyDecision,
  runShadowCompare,
} = require('../conversation/v3');

describe('V3-F1 venta mínima (mock, sin OpenAI)', () => {
  it('guion: Hola → venta → Jorge → Cumbres → 8M mantiene offer y expectedPrice', () => {
    let s = createInitialConversationState({ conversationId: 'c1', phone: '5218000000000' });
    const turns = ['Hola', 'Quiero vender mi casa', 'Jorge', 'Está en Cumbres', 'Vale como 8 millones'];

    for (const text of turns) {
      const { patch, decision } = interpretUserTextMock(s, text);
      const { state, guard } = applyV3StateTransition(s, patch, decision);
      assert.ok(guard.allowed, `guard debe permitir turno "${text}": ${guard.violations.join(',')}`);
      s = state;
    }

    assert.equal(s.leadFlow, 'offer');
    assert.notEqual(s.leadFlow, 'demand');
    assert.equal(s.locationText, 'Cumbres');
    assert.equal(s.expectedPrice, 8_000_000);
    assert.equal(s.budget, null);
    assert.equal(s.collectedFields.fullName, 'Jorge');
    assert.equal(s.conversationStage, CONVERSATION_STAGES.READY_FOR_CRM);
  });
});

describe('V3-F1 rule guard', () => {
  it('bloquea offer → demand sin explicitFlowSwitch', () => {
    const state = createInitialConversationState({});
    state.leadFlow = 'offer';
    const decision = createEmptyDecision();
    decision.detectedIntent = 'demand';
    decision.explicitFlowSwitch = false;
    const g = evaluateRuleGuard(state, decision, {});
    assert.equal(g.allowed, false);
    assert.ok(g.violations.includes('offer_to_demand_without_confirmation'));
  });
});

describe('V3-F1 shadow harness', () => {
  it('compara legacy vs stub V3 sin igualdad forzada', () => {
    const r = runShadowCompare({
      legacyText: 'Hola, te apoyo con gusto.',
      v3State: createInitialConversationState({}),
      v3Decision: createEmptyDecision(),
    });
    assert.equal(r.equal, false);
    assert.ok(r.v3Snippet.includes('v3-composer-stub'));
  });
});
