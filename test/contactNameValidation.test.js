const test = require('node:test');
const assert = require('node:assert/strict');

const { isUsefulContactName, isInvalidContactName } = require('../utils/helpers');

test('nombre multimedia no se considera útil', () => {
  assert.equal(isInvalidContactName('El usuario envió una imagen'), true);
  assert.equal(isUsefulContactName('El usuario envió una imagen'), false);
});

test('nombre útil de perfil WhatsApp sí es válido', () => {
  assert.equal(isInvalidContactName('Mariana Ruiz'), false);
  assert.equal(isUsefulContactName('Mariana Ruiz'), true);
});
