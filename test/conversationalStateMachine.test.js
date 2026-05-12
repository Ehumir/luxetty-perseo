'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const csm = require('../conversation/conversationalStateMachine');

test('shouldSoftExitPropertyToBuyerSearch detecta inventario por zona', () => {
  assert.equal(csm.shouldSoftExitPropertyToBuyerSearch('¿Tienes algo en Cumbres?'), true);
  assert.equal(csm.shouldSoftExitPropertyToBuyerSearch('Hay algo en San Pedro?'), true);
  assert.equal(csm.shouldSoftExitPropertyToBuyerSearch('¿Cuál es el precio?'), false);
});

test('computeSignalPatch: soft exit marca buyer_search', () => {
  const patch = csm.computeSignalPatch({
    text: '¿Tienes algo en Cumbres?',
    prevAiState: { active_playbook: csm.PLAYBOOKS.PROPERTY_SPECIFIC },
    parsedSignals: { __softExitPropertyMode: true },
  });
  assert.equal(patch.active_playbook, csm.PLAYBOOKS.BUYER_SEARCH);
  assert.equal(patch.active_intent, 'buyer_search');
});

test('computeSignalPatch: mixed interest por sell_buy_bridge', () => {
  const patch = csm.computeSignalPatch({
    text: 'Quiero vender mi casa y comprar otra',
    prevAiState: {},
    parsedSignals: { sell_buy_bridge: true, lead_flow: 'offer' },
  });
  assert.equal(patch.mixed_interest, true);
  assert.equal(patch.active_playbook, csm.PLAYBOOKS.MIXED_INTEREST);
});

test('applySellerLocationStickyPatch re-enfoca offer', () => {
  const patch = csm.applySellerLocationStickyPatch({
    text: 'En San Pedro',
    prevAiState: { lead_flow: 'offer', intent_lock_sale_owner: true },
    parsedSignals: { lead_flow: 'demand', operation_type: 'sale' },
  });
  assert.equal(patch.lead_flow, 'offer');
});
