'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createArgosNoWriteSupabase } = require('../argos/argosNoWriteSupabase');

function makeMockClient() {
  const mutations = [];
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    limit() {
      return builder;
    },
    async maybeSingle() {
      return { data: null, error: null };
    },
    insert() {
      mutations.push('insert');
      return builder;
    },
    update() {
      mutations.push('update');
      return builder;
    },
  };
  return {
    from() {
      return builder;
    },
    rpc() {
      mutations.push('rpc');
    },
    mutations,
  };
}

describe('argosDryRunNoWrites', () => {
  it('blocks insert on contacts', async () => {
    const raw = makeMockClient();
    const attempts = [];
    const wrapped = createArgosNoWriteSupabase(raw, {
      onMutationAttempt: (d) => attempts.push(d),
    });
    assert.throws(
      () => wrapped.from('contacts').insert({ phone: '5218100000001' }),
      (err) => err.code === 'ARGOS_SIDE_EFFECT_BLOCKED',
    );
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].table, 'contacts');
    assert.equal(raw.mutations.length, 0);
  });

  it('allows select on properties', async () => {
    const raw = makeMockClient();
    const wrapped = createArgosNoWriteSupabase(raw);
    const res = await wrapped.from('properties').select('*').eq('id', 'x').maybeSingle();
    assert.equal(res.data, null);
  });
});
