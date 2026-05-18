'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateOwnership } = require('../argos/ownershipValidator');

describe('argosOwnershipRules', () => {
  it('RULE_1: existing contact owner wins on demand', () => {
    const result = validateOwnership({
      contactPreview: {
        action: 'would_reuse',
        wasCreated: false,
        assigned_agent_profile_id: 'owner-a',
      },
      leadPreview: {
        lead_type: 'demand',
        assigned_agent_profile_id: 'owner-a',
        assignment_strategy: 'contact_owner',
      },
      aiState: { lead_type: 'demand' },
    });
    assert.equal(result.passed, true);
    assert.equal(result.rule, 'RULE_1_CONTACT_OWNER_DEMAND');
  });

  it('RULE_2: new contact with property uses property agent', () => {
    const result = validateOwnership({
      contactPreview: {
        action: 'would_create',
        wasCreated: true,
        assigned_agent_profile_id: 'prop-agent',
      },
      leadPreview: {
        lead_type: 'demand',
        assigned_agent_profile_id: 'prop-agent',
        assignment_strategy: 'property_owner_agent',
      },
      propertyAgentProfileId: 'prop-agent',
      aiState: { lead_type: 'demand' },
    });
    assert.equal(result.passed, true);
    assert.equal(result.rule, 'RULE_2_PROPERTY_AGENT_NEW_CONTACT');
  });

  it('fails when demand lead agent mismatches contact owner', () => {
    const result = validateOwnership({
      contactPreview: {
        action: 'would_reuse',
        wasCreated: false,
        assigned_agent_profile_id: 'owner-a',
      },
      leadPreview: {
        lead_type: 'demand',
        assigned_agent_profile_id: 'other-b',
      },
      aiState: { lead_type: 'demand' },
    });
    assert.equal(result.passed, false);
    assert.ok(result.violations.length > 0);
  });
});
