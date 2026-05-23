'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatPropertyTypeLabel,
  sanitizeSpanishOutboundText,
} = require('../utils/formatting');
const { buildSaleCaptiveContinuityReply } = require('../conversation/r0ContextContinuity');
const { normalizeOutboundMessages } = require('../utils/helpers');

describe('Spanish outbound — no English property types', () => {
  it('formatPropertyTypeLabel maps internal EN codes to Spanish', () => {
    assert.equal(formatPropertyTypeLabel('land'), 'terreno');
    assert.equal(formatPropertyTypeLabel('house'), 'casa');
    assert.equal(formatPropertyTypeLabel('apartment'), 'departamento');
    assert.equal(formatPropertyTypeLabel('LAND'), 'terreno');
    assert.equal(formatPropertyTypeLabel(null), 'propiedad');
    assert.equal(formatPropertyTypeLabel('unknown_type'), 'inmueble');
  });

  it('sanitizeSpanishOutboundText fixes leaked English in client copy', () => {
    assert.equal(
      sanitizeSpanishOutboundText('Sigo con la venta de tu land.'),
      'Sigo con la venta de tu terreno.',
    );
    assert.equal(
      sanitizeSpanishOutboundText('Perfecto, tu house en Cumbres.'),
      'Perfecto, tu casa en Cumbres.',
    );
    assert.equal(
      sanitizeSpanishOutboundText('Tu property listing está activa.'),
      'Tu propiedad está activa.',
    );
  });

  it('buildSaleCaptiveContinuityReply uses Spanish type label for land', () => {
    const reply = buildSaleCaptiveContinuityReply({
      text: 'continuar',
      aiState: { lead_flow: 'offer', property_type: 'land' },
    });
    assert.match(reply, /terreno/i);
    assert.doesNotMatch(reply, /\bland\b/i);
  });

  it('normalizeOutboundMessages sanitizes all outbound fragments', () => {
    const out = normalizeOutboundMessages(['Sigo con la venta de tu land.']);
    assert.equal(out[0], 'Sigo con la venta de tu terreno.');
  });
});
