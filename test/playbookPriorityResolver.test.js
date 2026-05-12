'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ppr = require('../conversation/playbookPriorityResolver');

test('buyer_search domina aunque exista property_code residual', () => {
  const ai = {
    property_code: 'LUX-A0470',
    direct_property_reference: false,
    property_specific_intent: false,
    active_playbook: 'buyer_search',
    lead_flow: 'demand',
  };
  assert.equal(ppr.shouldUsePropertySpecificFlow(ai), false);
});

test('property_specific activo cuando playbook lo indica', () => {
  const ai = {
    property_code: 'LUX-A0470',
    property_specific_intent: true,
    direct_property_reference: true,
    active_playbook: 'property_specific',
  };
  assert.equal(ppr.shouldUsePropertySpecificFlow(ai), true);
});

test('visit continuation fuerza flujo propiedad', () => {
  const ai = {
    property_code: 'LUX-A0470',
    active_playbook: 'buyer_search',
    visit_coordination_pending: true,
  };
  assert.equal(ppr.shouldUsePropertySpecificFlow(ai), true);
});
