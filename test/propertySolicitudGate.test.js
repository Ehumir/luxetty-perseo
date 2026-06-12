'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCaptureUrl,
  buildGateMessages,
} = require('../services/propertySolicitudGate');

describe('propertySolicitudGate', () => {
  it('buildCaptureUrl incluye slug y query captura', () => {
    const url = buildCaptureUrl({ slug: 'casa-en-puerta-de-hierro' });
    assert.match(url, /\/propiedad\/casa-en-puerta-de-hierro\?captura=1$/);
  });

  it('buildGateMessages es conversacional y no vacío', () => {
    const messages = buildGateMessages('https://luxetty.com/propiedad/demo?captura=1');
    assert.equal(messages.length, 3);
    assert.match(messages[0], /registrar tu solicitud/i);
    assert.match(messages[1], /captura=1/);
    assert.match(messages[2], /escríbeme de nuevo/i);
  });
});
