'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  processV3Turn,
  CONVERSATION_STAGES,
  CONVERSATION_GOALS,
  assertComposerQuality,
  clearV3Session,
  evaluateRuleGuard,
  createEmptyDecision,
} = require('../conversation/v3');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');

function runScript(conversationId, turns) {
  clearV3Session(conversationId);
  let last;
  for (const text of turns) {
    last = processV3Turn({ conversationId, phone: '5218110000001', text });
    assert.ok(last.ok, `turn failed: ${text}`);
  }
  return last;
}

describe('V3-F2 venta mínima con composer humano', () => {
  it('guion completo: Hola → venta → Jorge → Cumbres → 8M', () => {
    const last = runScript('f2-sell-1', [
      'Hola',
      'Quiero vender mi casa',
      'Jorge',
      'Está en Cumbres',
      'Vale como 8 millones',
    ]);
    const s = last.state;
    assert.equal(s.conversationGoal, CONVERSATION_GOALS.SELL_PROPERTY);
    assert.equal(s.conversationGoalLocked, true);
    assert.equal(s.leadFlow, 'offer');
    assert.notEqual(s.leadFlow, 'demand');
    assert.equal(s.collectedFields.fullName, 'Jorge');
    assert.equal(s.locationText, 'Cumbres');
    assert.equal(s.expectedPrice, 8_000_000);
    assert.equal(s.budget, null);
    assert.equal(s.conversationStage, CONVERSATION_STAGES.PROPERTY_CONTEXT);
    assert.match(String(last.reply), /Jorge/i);
    assert.ok(assertComposerQuality(last.reply));
    assert.doesNotMatch(String(last.reply), /house/i);
    assert.doesNotMatch(String(last.reply), /dime en una frase/i);
  });
});

describe('V3-F2 compra', () => {
  it('Hola → busco Cumbres → 8M → 3 recámaras', () => {
    const last = runScript('f2-buy-1', [
      'Hola',
      'Busco casa en Cumbres',
      '8 millones',
      'que tenga 3 recámaras',
    ]);
    const s = last.state;
    assert.equal(s.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.equal(s.leadFlow, 'demand');
    assert.equal(s.locationText, 'Cumbres');
    assert.equal(s.budget, 8_000_000);
    assert.equal(s.bedrooms, 3);
  });
});

describe('V3-F2 protección contextual venta', () => {
  it('venta + montos cortos no cambia a demanda', () => {
    const last = runScript('f2-sticky-1', ['Quiero vender mi casa', '8 millones', 'Cumbres']);
    assert.equal(last.state.leadFlow, 'offer');
    assert.equal(last.state.expectedPrice, 8_000_000);
    assert.equal(last.state.budget, null);
  });
});

describe('V3-F2 cambio explícito', () => {
  it('permite pasar a compra con frase explícita', () => {
    clearV3Session('f2-switch-1');
    processV3Turn({ conversationId: 'f2-switch-1', phone: '521', text: 'Quiero vender mi casa' });
    const last = processV3Turn({
      conversationId: 'f2-switch-1',
      phone: '521',
      text: 'Ahora busco comprar',
    });
    assert.equal(last.state.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.equal(last.state.leadFlow, 'demand');
  });
});

describe('V3-F2 identidad', () => {
  it('no pide nombre después de Jorge', () => {
    clearV3Session('f2-name-1');
    processV3Turn({ conversationId: 'f2-name-1', phone: '521', text: 'Quiero vender mi casa' });
    const afterName = processV3Turn({ conversationId: 'f2-name-1', phone: '521', text: 'Jorge' });
    const reply = String(afterName.reply);
    assert.doesNotMatch(reply, /cual es tu nombre/i);
    assert.doesNotMatch(reply, /cómo te llamas/i);
    assert.match(reply, /Jorge/i);
  });
});

describe('V3-F2 frustración', () => {
  it('responde con empatía sin "Listo, retomo"', () => {
    const last = processV3Turn({
      conversationId: 'f2-frust-1',
      phone: '521',
      text: '¿No me entiendes?',
    });
    assert.match(String(last.reply), /tienes razón|más claro/i);
    assert.doesNotMatch(String(last.reply), /listo,\s*retomo/i);
  });
});

describe('V3-F2 rule guard', () => {
  it('bloquea offer→demand sin confirmación', () => {
    const state = createInitialConversationState({});
    state.leadFlow = 'offer';
    state.conversationGoal = CONVERSATION_GOALS.SELL_PROPERTY;
    state.conversationGoalLocked = true;
    const decision = createEmptyDecision();
    decision.detectedIntent = 'BUY_PROPERTY';
    decision.explicitFlowSwitch = false;
    const g = evaluateRuleGuard(state, decision, {});
    assert.equal(g.allowed, false);
  });
});
