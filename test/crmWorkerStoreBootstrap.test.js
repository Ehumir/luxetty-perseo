'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  resetRuntimeTableProbeCache,
  areCrmRuntimeTablesAvailable,
} = require('../conversation/v3/runtime/runtimeTableProbe');

describe('crm worker store probe cache', () => {
  beforeEach(() => {
    resetRuntimeTableProbeCache();
    delete process.env.PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED;
    delete process.env.PERSEO_ARGOS_ENABLED;
  });

  it('does not cache negative crm probe (allows recovery after first miss)', async () => {
    process.env.PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED = 'true';
    let calls = 0;
    const supabase = {
      from: () => ({
        select: async () => {
          calls += 1;
          if (calls === 1) {
            return { error: { message: 'crm_outbox missing' } };
          }
          return { error: null, count: 0 };
        },
      }),
    };

    const first = await areCrmRuntimeTablesAvailable(supabase, {});
    const second = await areCrmRuntimeTablesAvailable(supabase, {});

    assert.equal(first, false);
    assert.equal(second, true);
    assert.equal(calls, 2);
  });
});
