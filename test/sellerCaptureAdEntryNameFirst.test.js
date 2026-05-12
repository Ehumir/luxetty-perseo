'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const router = require('../conversation/leadEntryPointRouter');

test('captación: presentación y nombre, sin menú de compra', () => {
  const entry = router.classifyEntryPoint(
    'Hola, quiero saber cómo podrían ayudarme a vender mi casa en Cumbres',
    {}
  );
  const r = router.buildInitialEntryReply({ entry, property: null, aiState: {} });
  assert.match(r, /asistente de Luxetty/i);
  assert.match(r, /Cumbres/i);
  assert.match(r, /compartes tu nombre/i);
  assert.doesNotMatch(r, /presupuesto/i);
  assert.doesNotMatch(r, /búsqueda/i);
});
