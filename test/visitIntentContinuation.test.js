'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const psf = require('../conversation/propertySpecificFlow');

test('looksLikeVisitTimeAnswer detecta horario', () => {
  assert.equal(psf.looksLikeVisitTimeAnswer('mañana a las 5pm'), true);
  assert.equal(psf.looksLikeVisitTimeAnswer('¿sigue disponible?'), false);
});

test('classify visit_schedule cuando hay pending', () => {
  const intent = psf.classifyPropertyFollowUp('mañana a las 5', {
    property_code: 'LUX-A0470',
    property_specific_intent: true,
    direct_property_reference: true,
    active_playbook: 'property_specific',
    visit_coordination_pending: true,
  }, []);
  assert.equal(intent.type, 'visit_schedule_follow_up');
});
