'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { _private: idx } = require('../index');

test('nombre ya en conversación: reconoce reclamo sin menú property', () => {
  const reply = idx.buildConsultiveFallbackReply({
    text: 'Ya te di mi nombre',
    signals: { lead_flow: 'demand' },
    aiState: { full_name: 'Jorge López', active_playbook: 'buyer_search', lead_flow: 'demand' },
    contact: null,
    waProfileName: null,
    resolvedPropertyRow: null,
    recentMessages: [],
  });
  assert.match(reply, /Jorge|ya quedó registrado/i);
});
