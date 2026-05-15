'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const r0 = require('../conversation/r0ContextContinuity');
const { mergeContextualSignals } = require('../conversation/contextualMemoryResolver');
const { getDefaultAiState } = require('../conversation/aiState');
const { _private: idx } = require('../index');

describe('R0 P0.1.2 context continuity', () => {
  it('comprador demand + operation_type sale + presupuesto NO es sticky captación', () => {
    assert.equal(
      r0.isR0StickySaleCaptureThread({
        ...getDefaultAiState(),
        lead_flow: 'demand',
        operation_type: 'sale',
        location_text: 'Cumbres',
        budget_max: 8_000_000,
      }),
      false
    );
  });

  it('applyR0StickySignalsGuard elimina lead_flow demand y budget_max del parser en hilo venta', () => {
    const prev = { ...getDefaultAiState(), lead_flow: 'offer', operation_type: 'sale', location_text: null };
    const sig = { lead_flow: 'demand', location_text: 'Cumbres', budget_max: 8_000_000, expected_price: null };
    const out = r0.applyR0StickySignalsGuard(prev, sig, 'está en Cumbres');
    assert.equal(out.lead_flow, undefined);
    assert.equal(out.budget_max, undefined);
    assert.equal(out.expected_price, 8_000_000);
    assert.equal(out.location_text, 'Cumbres');
  });

  it('permite cambio a demanda si el usuario lo dice explícitamente', () => {
    const prev = { ...getDefaultAiState(), lead_flow: 'offer', operation_type: 'sale' };
    const sig = { lead_flow: 'demand' };
    const out = r0.applyR0StickySignalsGuard(prev, sig, 'busco casa en Cumbres');
    assert.equal(out.lead_flow, 'demand');
  });

  it('mergeContextualSignals no infiere budget_max de comprador cuando prev.operation_type es sale', () => {
    const prev = { ...getDefaultAiState(), lead_flow: 'offer', operation_type: 'sale', location_text: 'Cumbres' };
    const built = { ...prev };
    const patch = mergeContextualSignals({}, prev, built, '8 millones');
    assert.ok(!Object.prototype.hasOwnProperty.call(patch, 'budget_max'));
  });

  it('buildConsultiveFallbackReply: Cumbres con señales demand no dice buscar casa si aiState es venta', () => {
    const reply = idx.buildConsultiveFallbackReply({
      text: 'está en Cumbres',
      signals: { lead_flow: 'demand', location_text: 'Cumbres' },
      aiState: {
        ...getDefaultAiState(),
        lead_flow: 'offer',
        operation_type: 'sale',
        location_text: 'Cumbres',
      },
      contact: null,
      waProfileName: null,
    });
    assert.doesNotMatch(String(reply), /buscar casa/i);
    assert.match(String(reply), /venta|zona|Cumbres/i);
  });

  it('regresión guion venta: montos y nombre no disparan demanda', () => {
    let st = { ...getDefaultAiState(), lead_flow: 'offer', operation_type: 'sale', location_text: null };
    let r = idx.buildConsultiveFallbackReply({
      text: '8 millones',
      signals: { lead_flow: 'demand', budget_max: 8e6 },
      aiState: st,
    });
    assert.doesNotMatch(String(r), /buscar casa|presupuesto aproximado/i);

    st = { ...st, location_text: 'Cumbres', expected_price: 8e6 };
    r = idx.buildConsultiveFallbackReply({
      text: 'Jorge',
      signals: { lead_flow: 'demand', full_name: 'Jorge' },
      aiState: st,
    });
    assert.doesNotMatch(String(r), /búsqueda|buscar casa/i);
    assert.match(String(r), /venta|Jorge/i);
  });
});
