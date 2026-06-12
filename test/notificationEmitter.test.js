'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDedupeKey,
  isOwnerOfferSignal,
  emitLeadUnassigned,
  emitCrmError,
  emitHumanHandoffRequired,
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

  it('buildDedupeKey lead_unassigned usa lead_id', () => {
    assert.equal(buildDedupeKey('lead_unassigned', ['uuid-lead']), 'lead_unassigned:uuid-lead');
  });

  it('buildDedupeKey crm_error usa conversation y código', () => {
    assert.equal(
      buildDedupeKey('crm_error', ['conv-1', 'lead_automation_error']),
      'crm_error:conv-1:lead_automation_error'
    );
  });

  it('buildDedupeKey human_handoff usa conversation y reason', () => {
    assert.equal(
      buildDedupeKey('human_handoff', ['conv-2', 'wants_human_auto_escalation']),
      'human_handoff:conv-2:wants_human_auto_escalation'
    );
  });

  it('emitLeadUnassigned requiere leadId', async () => {
    const result = await emitLeadUnassigned(null, { leadId: null }, () => {});
    assert.equal(result.ok, false);
  });

  it('emitCrmError requiere conversationId', async () => {
    const result = await emitCrmError(null, { conversationId: null }, () => {});
    assert.equal(result.ok, false);
  });

  it('emitHumanHandoffRequired requiere conversationId', async () => {
    const result = await emitHumanHandoffRequired(null, { conversationId: null }, () => {});
    assert.equal(result.ok, false);
  });
});
