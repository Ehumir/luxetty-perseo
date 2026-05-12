'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const conversationalStateMachine = require('../conversation/conversationalStateMachine');
const propertySpecificFlow = require('../conversation/propertySpecificFlow');
const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');

test('sell_buy_bridge marca mixed en computeSignalPatch', () => {
  const patch = conversationalStateMachine.computeSignalPatch({
    text: 'Quiero vender y comprar otra',
    prevAiState: {},
    parsedSignals: { sell_buy_bridge: true },
  });
  assert.equal(patch.mixed_interest, true);
  assert.equal(patch.buyer_context_active, true);
  assert.equal(patch.seller_context_active, true);
});

test('name complaint con nombre en conversación usa primer nombre', () => {
  const reply = propertySpecificFlow.buildNameComplaintReply({
    aiState: { full_name: 'Jorge Pérez' },
    contact: null,
    hasRegisteredName: true,
    text: 'Ya te di mi nombre',
  });
  assert.match(reply, /Jorge/);
  assert.match(reply, /ya quedó registrado/i);
});

test('normalizeAiState conserva flags de máquina conversacional', () => {
  const s = normalizeAiState({
    ...getDefaultAiState(),
    active_playbook: 'seller_capture',
    mixed_interest: true,
  });
  assert.equal(s.active_playbook, 'seller_capture');
  assert.equal(s.mixed_interest, true);
});
