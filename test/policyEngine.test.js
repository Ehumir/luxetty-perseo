'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { evaluatePolicy, resolveZoneStatus } = require('../conversation/v3/policy/PolicyEngine');
const { clearPolicyConfigCache } = require('../conversation/v3/policy/policyConfigLoader');

describe('PolicyEngine', () => {
  it('declines sale below 3M MXN', () => {
    clearPolicyConfigCache();
    const result = evaluatePolicy({
      state: {},
      decision: {},
      text: 'Quiero vender en Cumbres en 2.5 millones',
      segments: [
        {
          index: 0,
          text: 'Quiero vender en Cumbres en 2.5 millones',
          intents: ['offer'],
          slots: { money: { amount: 2500000, currency: 'MXN', operationType: 'sale' }, locationText: 'Cumbres' },
        },
      ],
    });
    assert.equal(result.decision, 'DECLINE_SOFT');
    assert.equal(result.rule_id, 'sale_min_mxn');
  });

  it('marks active zone as ATTEND', () => {
    clearPolicyConfigCache();
    const zone = resolveZoneStatus('Cumbres', require('../config/policy/active-zones.v1.json'));
    assert.equal(zone.status, 'active');
  });
});
