'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDedupeKey,
  isOwnerOfferSignal,
} = require('../services/notificationEmitter');

describe('notificationEmitter', () => {
  it('buildDedupeKey concatena evento y partes', () => {
    assert.equal(
      buildDedupeKey('lead_assigned', ['lead-1', 'agent-2']),
      'lead_assigned:lead-1:agent-2'
    );
  });

  it('isOwnerOfferSignal detecta seller_capture_ad', () => {
    assert.equal(
      isOwnerOfferSignal(
        { __entry_point_meta: { entry_type: 'seller_capture_ad' } },
        {}
      ),
      true
    );
  });

  it('isOwnerOfferSignal detecta lead_flow offer', () => {
    assert.equal(isOwnerOfferSignal({}, { lead_flow: 'offer' }), true);
    assert.equal(isOwnerOfferSignal({ lead_flow: 'offer' }, {}), true);
  });

  it('isOwnerOfferSignal false para demanda', () => {
    assert.equal(isOwnerOfferSignal({}, { lead_flow: 'demand' }), false);
  });
});
