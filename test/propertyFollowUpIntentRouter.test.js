'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { routePropertyFollowUpIntent } = require('../conversation/propertyFollowUpIntentRouter');

test('router: visita y hora propuesta', () => {
  const askVisit = routePropertyFollowUpIntent('ok, ¿cuándo puedo verla?', {});
  assert.equal(askVisit.type, 'ask_visit');

  const time = routePropertyFollowUpIntent('mañana a las 5pm', { visit_coordination_pending: true });
  assert.equal(time.type, 'visit_time_proposed');
});

test('router: todo y frustración', () => {
  assert.equal(routePropertyFollowUpIntent('todo', {}).type, 'ask_all_available_info');
  assert.equal(routePropertyFollowUpIntent('ya vi que eres un bot', {}).type, 'frustration_recovery');
});
