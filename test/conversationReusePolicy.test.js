const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPhoneLookupValues,
  selectConversationReuseStrategy,
} = require('../utils/helpers');

test('conversation reuse policy: phone lookup values cover mexican whatsapp variants', () => {
  const values = buildPhoneLookupValues('+52 81 8187 7351');

  assert.equal(values.includes('5218181877351'), true);
  assert.equal(values.includes('+5218181877351'), true);
  assert.equal(values.includes('528181877351'), true);
  assert.equal(values.includes('+528181877351'), true);
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