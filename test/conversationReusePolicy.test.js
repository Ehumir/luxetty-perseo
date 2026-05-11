const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPhoneLookupValues,
  selectConversationReuseStrategy,
  chooseCanonicalReusableConversation,
} = require('../utils/helpers');

test('conversation reuse policy: phone lookup values cover mexican whatsapp variants', () => {
  const values = buildPhoneLookupValues('+52 81 8187 7351');

  assert.equal(values.includes('5218181877351'), true);
  assert.equal(values.includes('+5218181877351'), true);
  assert.equal(values.includes('528181877351'), true);
  assert.equal(values.includes('+528181877351'), true);
  assert.equal(values.includes('8181877351'), true, '10-digit national key for DB rows stored as local');
});

test('conversation reuse policy: lookup includes 521 / 52 / 10-digit and plus forms for MX WA', () => {
  const fromNormalized = buildPhoneLookupValues('5218112345678');
  assert.ok(fromNormalized.includes('5218112345678'));
  assert.ok(fromNormalized.includes('+5218112345678'));
  assert.ok(fromNormalized.includes('528112345678'));
  assert.ok(fromNormalized.includes('8112345678'));
});

test('conversation reuse policy: reuses latest non-closed conversation', () => {
  const strategy = selectConversationReuseStrategy(
    [
      {
        id: 'conv-closed',
        status: 'closed',
        phone: '528181877351',
        created_at: '2026-05-08T09:00:00.000Z',
        updated_at: '2026-05-08T09:00:00.000Z',
        last_message_at: '2026-05-08T09:00:00.000Z',
        contact_id: 'contact-1',
        lead_id: 'lead-1',
        assigned_agent_profile_id: 'agent-1',
        external_contact_id: 'wa-1',
      },
      {
        id: 'conv-open',
        status: 'open',
        phone: '528181877351',
        created_at: '2026-05-08T10:00:00.000Z',
        updated_at: '2026-05-08T10:05:00.000Z',
        last_message_at: '2026-05-08T10:05:00.000Z',
        contact_id: 'contact-2',
        lead_id: 'lead-2',
        assigned_agent_profile_id: 'agent-2',
        external_contact_id: 'wa-2',
      },
    ],
    '5218181877351'
  );

  assert.equal(strategy.reusableConversation?.id, 'conv-open');
  assert.equal(strategy.shouldNormalizeReusablePhone, true);
});

test('conversation reuse policy: multiple open prefers lead_id over fresher last_message_at', () => {
  const strategy = selectConversationReuseStrategy(
    [
      {
        id: 'conv-newer-no-lead',
        status: 'open',
        phone: '5218181877351',
        created_at: '2026-05-08T12:00:00.000Z',
        updated_at: '2026-05-08T12:00:00.000Z',
        last_message_at: '2026-05-08T12:30:00.000Z',
        contact_id: 'contact-x',
        lead_id: null,
        assigned_agent_profile_id: null,
        external_contact_id: null,
      },
      {
        id: 'conv-with-lead-older',
        status: 'open',
        phone: '5218181877351',
        created_at: '2026-05-08T09:00:00.000Z',
        updated_at: '2026-05-08T09:00:00.000Z',
        last_message_at: '2026-05-08T09:05:00.000Z',
        contact_id: null,
        lead_id: 'lead-priority',
        assigned_agent_profile_id: null,
        external_contact_id: null,
      },
    ],
    '5218181877351'
  );

  assert.equal(strategy.reusableConversation?.id, 'conv-with-lead-older');
  assert.equal(strategy.hasMultipleReusableConversations, true);
  assert.deepEqual(strategy.duplicateReusableConversationIds, ['conv-newer-no-lead']);
  assert.equal(strategy.multipleReusableResolutionReason, 'canonical_lead_contact_recency_then_id');
});

test('conversation reuse policy: multiple open without lead prefers contact_id', () => {
  const strategy = selectConversationReuseStrategy(
    [
      {
        id: 'conv-no-contact-newer',
        status: 'open',
        phone: '5218181877351',
        created_at: '2026-05-08T11:00:00.000Z',
        updated_at: '2026-05-08T11:00:00.000Z',
        last_message_at: '2026-05-08T20:00:00.000Z',
        contact_id: null,
        lead_id: null,
        assigned_agent_profile_id: null,
        external_contact_id: null,
      },
      {
        id: 'conv-has-contact-older',
        status: 'open',
        phone: '5218181877351',
        created_at: '2026-05-08T10:00:00.000Z',
        updated_at: '2026-05-08T10:00:00.000Z',
        last_message_at: '2026-05-08T10:05:00.000Z',
        contact_id: 'contact-keep',
        lead_id: null,
        assigned_agent_profile_id: null,
        external_contact_id: null,
      },
    ],
    '5218181877351'
  );

  assert.equal(strategy.reusableConversation?.id, 'conv-has-contact-older');
  assert.equal(strategy.hasMultipleReusableConversations, true);
});

test('conversation reuse policy: multiple open without lead/contact uses last_message_at then updated_at', () => {
  const strategy = selectConversationReuseStrategy(
    [
      {
        id: 'conv-older-thread',
        status: 'open',
        phone: '5218181877351',
        created_at: '2026-05-08T08:00:00.000Z',
        updated_at: '2026-05-08T08:00:00.000Z',
        last_message_at: '2026-05-08T08:30:00.000Z',
        contact_id: null,
        lead_id: null,
        assigned_agent_profile_id: null,
        external_contact_id: null,
      },
      {
        id: 'conv-newer-thread',
        status: 'open',
        phone: '5218181877351',
        created_at: '2026-05-08T08:00:00.000Z',
        updated_at: '2026-05-08T09:00:00.000Z',
        last_message_at: '2026-05-08T10:00:00.000Z',
        contact_id: null,
        lead_id: null,
        assigned_agent_profile_id: null,
        external_contact_id: null,
      },
    ],
    '5218181877351'
  );

  assert.equal(strategy.reusableConversation?.id, 'conv-newer-thread');
});

test('conversation reuse policy: chooseCanonicalReusableConversation single row', () => {
  const row = { id: 'only-one', status: 'open', lead_id: null };
  const r = chooseCanonicalReusableConversation([row]);
  assert.equal(r.canonical, row);
  assert.deepEqual(r.duplicateIds, []);
  assert.equal(r.resolutionReason, 'single_reusable_conversation');
});

test('conversation reuse policy: closed-only history creates new conversation but preserves commercial linkage', () => {
  const strategy = selectConversationReuseStrategy(
    [
      {
        id: 'conv-old',
        status: 'closed',
        phone: '5218181877351',
        created_at: '2026-05-08T08:00:00.000Z',
        updated_at: '2026-05-08T08:30:00.000Z',
        last_message_at: '2026-05-08T08:30:00.000Z',
        contact_id: 'contact-9',
        lead_id: 'lead-9',
        assigned_agent_profile_id: 'agent-9',
        external_contact_id: 'wa-9',
      },
    ],
    '5218181877351'
  );

  assert.equal(strategy.reusableConversation, null);
  assert.deepEqual(strategy.createSeed, {
    contact_id: 'contact-9',
    lead_id: 'lead-9',
    assigned_agent_profile_id: 'agent-9',
    external_contact_id: 'wa-9',
  });
});