'use strict';

/**
 * Matriz QA P0 — conversacional (no es unit test aislado: recorre 20 hilos multi-turno).
 * @see test/qaMatrixP0ConversationalHarness.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runAllMatrix } = require('./qaMatrixP0ConversationalHarness');

test('MATRIZ QA P0: 20 conversaciones simuladas tipo WhatsApp — todas PASS', () => {
  const results = runAllMatrix();
  assert.equal(results.length, 20, 'debe haber exactamente 20 escenarios');
  const failed = results.filter((r) => !r.pass);
  assert.deepEqual(
    failed.map((r) => ({ id: r.id, obs: r.observations })),
    [],
    `Fallaron: ${failed.map((f) => f.id).join(', ')}`
  );
});
