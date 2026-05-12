'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseMessageSignals,
  isPropertyConversationFollowUp,
  detectOwnerRelation,
  detectSellBuyBridge,
} = require('../conversation/parsers');
const { getDefaultAiState } = require('../conversation/aiState');
const { appendNameRequestIfNeeded } = require('../conversation/namePrompt');

test('P1 Hilo A — nombre con awaiting presupuesto + pending_name_capture', () => {
  const prev = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
    operation_type: 'sale',
    awaiting_field: 'budget_max',
    pending_name_capture: true,
  };
  const signals = parseMessageSignals('Jorge', prev, {});
  assert.equal(signals.full_name, 'Jorge');
});

test('P1 Hilo A — Cumbres con awaiting ubicación no es nombre', () => {
  const prev = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
    awaiting_field: 'location_text',
  };
  const signals = parseMessageSignals('Cumbres', prev, {});
  assert.equal(signals.full_name, null);
  assert.ok(signals.location_text);
});

test('P1 Hilo C — Mía en oferta es propietario, no nombre', () => {
  const prev = {
    ...getDefaultAiState(),
    lead_flow: 'offer',
    operation_type: 'sale',
    owner_relation: null,
    awaiting_field: 'owner_relation',
  };
  const owner = detectOwnerRelation('Mía', prev);
  assert.equal(owner, 'owner');
  const signals = parseMessageSignals('Mía', prev, {});
  assert.equal(signals.owner_relation, 'owner');
  assert.equal(signals.full_name, null);
});

test('P1 Hilo C — Sí contextual oferta sin owner previo', () => {
  const prev = {
    ...getDefaultAiState(),
    lead_flow: 'offer',
    operation_type: 'sale',
    owner_relation: null,
    awaiting_field: 'owner_relation',
  };
  assert.equal(detectOwnerRelation('Sí', prev), 'owner');
});

test('P1 Hilo C — Sí fuera de contexto oferta no fuerza owner', () => {
  const prev = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
  };
  assert.equal(detectOwnerRelation('Sí', prev), null);
});

test('P1 Hilo D — también quiero comprar una', () => {
  assert.equal(detectSellBuyBridge('también quiero comprar una'), true);
  assert.equal(detectSellBuyBridge('tambien quiero comprar una'), true);
});

test('P1 propiedad — follow-up precio/disponibilidad', () => {
  assert.equal(isPropertyConversationFollowUp('¿Cuál es el precio?'), true);
  assert.equal(isPropertyConversationFollowUp('¿Sigue disponible?'), true);
  assert.equal(isPropertyConversationFollowUp('¿La puedo ver?'), true);
});

test('P1 namePrompt — pending_name_capture si awaiting comercial', () => {
  const aiState = {
    ...getDefaultAiState(),
    lead_flow: 'demand',
    awaiting_field: 'budget_max',
  };
  const { statePatch, setAwaitingFullName } = appendNameRequestIfNeeded('¿Cuál es tu presupuesto?', {
    contact: null,
    aiState,
    waProfileDisplayName: null,
    recentOutboundTexts: [],
    userInboundText: 'Busco en Cumbres',
    leadFlow: 'demand',
    wantsVisit: false,
  });
  assert.equal(setAwaitingFullName, false);
  assert.equal(statePatch.pending_name_capture, true);
});
