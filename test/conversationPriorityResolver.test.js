'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePriorityIntent,
  applyPriorityToSignals,
  PRIORITY,
} = require('../conversation/conversationPriorityResolver');
const { getDefaultAiState } = require('../conversation/aiState');

describe('conversationPriorityResolver', () => {
  it('humano gana siempre', () => {
    const p = resolvePriorityIntent('Asesor personal', getDefaultAiState(), {
      lead_flow: 'demand',
      property_code: 'LUX-A0001',
    });
    assert.equal(p.priority, PRIORITY.HUMAN);
  });

  it('seller gana sobre greeting implícito', () => {
    const p = resolvePriorityIntent(
      'Buenas noches me comparten información para promover una propiedad',
      getDefaultAiState(),
      {},
    );
    assert.equal(p.key, 'seller_capture');
    assert.equal(p.lead_flow, 'offer');
  });

  it('greeting no pisa seller sticky', () => {
    const prev = { ...getDefaultAiState(), lead_flow: 'offer', operation_type: 'sale' };
    const p = resolvePriorityIntent('hola', prev, {});
    assert.equal(p.key, 'seller_capture');
  });

  it('meta_general antes que greeting genérico', () => {
    const p = resolvePriorityIntent(
      'Estoy navegando en facebook y Vi su página inmobiliaria',
      getDefaultAiState(),
      {},
    );
    assert.equal(p.key, 'meta_general');
    assert.ok(p.priority < PRIORITY.GREETING);
  });

  it('applyPriorityToSignals fuerza offer en vender+zona', () => {
    const sig = applyPriorityToSignals(
      { lead_flow: 'demand', location_text: 'García' },
      'Vender una propiedad ubicada en garcia por la reserva',
      getDefaultAiState(),
    );
    assert.equal(sig.lead_flow, 'offer');
  });
});
