'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCrmIdempotencyKey,
  reconcileCrmState,
  executeV3CrmWithFoundation,
  resetCrmFoundationQueue,
} = require('../conversation/v3/crm/crmExecuteFoundation');

describe('crmExecuteFoundation', () => {
  it('builds stable idempotency key', () => {
    const key = buildCrmIdempotencyKey(
      { conversationId: 'c1', conversationGoal: 'BUY_PROPERTY' },
      { property_listing_code: 'LUX-A1' },
    );
    assert.match(key, /^c1:/);
  });

  it('reconcile detects completed without lead', () => {
    const r = reconcileCrmState({ crmExecutionCompleted: true, crmLeadId: null });
    assert.equal(r.consistent, false);
  });

  it('collision blocks duplicate enqueue', async () => {
    process.env.PERSEO_CRM_EXECUTE_FOUNDATION_ENABLED = 'true';
    resetCrmFoundationQueue('conv-collision');
    const core = async (input) => ({
      v3State: {
        ...input.v3State,
        conversationId: 'conv-collision',
        crmExecutionCompleted: true,
        crmLeadId: 'l1',
        timestamps: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        collectedFields: {},
      },
      executed: true,
    });
    const state = {
      conversationId: 'conv-collision',
      crmPayloadPreview: { intent: 'buy', property_listing_code: 'X' },
    };
    const first = await executeV3CrmWithFoundation({ v3State: state }, core);
    assert.equal(first.executed, true);
    const second = await executeV3CrmWithFoundation({ v3State: state }, core);
    assert.equal(second.skipped, true);
    assert.equal(second.reason, 'foundation_collision');
    delete process.env.PERSEO_CRM_EXECUTE_FOUNDATION_ENABLED;
    resetCrmFoundationQueue('conv-collision');
  });
});
