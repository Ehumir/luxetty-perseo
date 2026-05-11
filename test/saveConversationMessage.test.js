const test = require('node:test');
const assert = require('node:assert/strict');

const {
  saveConversationMessage,
  inboundMessageAlreadyProcessed,
} = require('../services/saveConversationMessage');

function insertSelectSingle23505() {
  return {
    insert() {
      return this;
    },
    select() {
      return this;
    },
    async single() {
      return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    },
  };
}

test('saveConversationMessage: 23505 on insert returns existing row by meta_message_id (idempotent)', async () => {
  const existingRow = {
    id: 'msg-existing',
    conversation_id: 'conv-a',
    direction: 'inbound',
    meta_message_id: 'wamid.DEDUP',
    message_text: 'hola',
    sender_type: 'lead',
    message_type: 'text',
  };

  let convFromCalls = 0;
  let msgFromCalls = 0;

  const supabase = {
    from(table) {
      if (table === 'conversations') {
        convFromCalls += 1;
        return {
          update() {
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      if (table === 'conversation_messages') {
        msgFromCalls += 1;
        if (msgFromCalls === 1) {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
          };
        }
        if (msgFromCalls === 2) {
          return insertSelectSingle23505();
        }
        if (msgFromCalls === 3) {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return this;
            },
            maybeSingle: async () => ({ data: existingRow, error: null }),
          };
        }
      }
      throw new Error(`unexpected from(${table}) call #${msgFromCalls}`);
    },
  };

  const result = await saveConversationMessage(supabase, {
    conversationId: 'conv-a',
    direction: 'inbound',
    senderType: 'lead',
    messageType: 'text',
    messageText: 'hola',
    metaMessageId: 'wamid.DEDUP',
    rawPayload: {},
  });

  assert.deepEqual(result, existingRow);
  assert.equal(msgFromCalls, 3);
  assert.equal(convFromCalls, 0, 'no conversation bump when insert lost race (existing row returned)');
});

test('saveConversationMessage: 23505 but no row found keeps safe null', async () => {
  let msgFromCalls = 0;
  const supabase = {
    from(table) {
      if (table === 'conversation_messages') {
        msgFromCalls += 1;
        if (msgFromCalls === 1) {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
          };
        }
        if (msgFromCalls === 2) {
          return {
            insert() {
              return this;
            },
            select() {
              return this;
            },
            async single() {
              return { data: null, error: { code: '23505', message: 'dup' } };
            },
          };
        }
        if (msgFromCalls === 3) {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return this;
            },
            maybeSingle: async () => ({ data: null, error: null }),
          };
        }
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const result = await saveConversationMessage(supabase, {
    conversationId: 'conv-b',
    direction: 'inbound',
    senderType: 'lead',
    messageType: 'text',
    messageText: 'x',
    metaMessageId: 'wamid-orphan',
    rawPayload: {},
  });

  assert.equal(result, null);
  assert.equal(msgFromCalls, 3);
});

test('saveConversationMessage: non-23505 insert error returns null (unchanged)', async () => {
  let msgFromCalls = 0;
  const supabase = {
    from(table) {
      if (table === 'conversation_messages') {
        msgFromCalls += 1;
        if (msgFromCalls === 1) {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
          };
        }
        return {
          insert() {
            return this;
          },
          select() {
            return this;
          },
          async single() {
            return { data: null, error: { code: '23503', message: 'foreign key violation' } };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const result = await saveConversationMessage(supabase, {
    conversationId: 'conv-c',
    direction: 'inbound',
    senderType: 'lead',
    messageType: 'text',
    messageText: 'x',
    metaMessageId: 'wamid-fk',
    rawPayload: {},
  });

  assert.equal(result, null);
  assert.equal(msgFromCalls, 2);
});

test('saveConversationMessage: successful insert still updates conversation and returns row', async () => {
  const inserted = {
    id: 'msg-new',
    conversation_id: 'conv-d',
    meta_message_id: 'wamid-ok',
    message_text: 'ok',
  };
  let msgFromCalls = 0;
  let convUpdated = false;

  const supabase = {
    from(table) {
      if (table === 'conversations') {
        return {
          update() {
            convUpdated = true;
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      if (table === 'conversation_messages') {
        msgFromCalls += 1;
        if (msgFromCalls === 1) {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            limit() {
              return Promise.resolve({ data: [], error: null });
            },
          };
        }
        return {
          insert() {
            return this;
          },
          select() {
            return this;
          },
          async single() {
            return { data: inserted, error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const result = await saveConversationMessage(supabase, {
    conversationId: 'conv-d',
    direction: 'inbound',
    senderType: 'lead',
    messageType: 'text',
    messageText: 'ok',
    metaMessageId: 'wamid-ok',
    rawPayload: {},
  });

  assert.deepEqual(result, inserted);
  assert.equal(convUpdated, true);
});

test('inboundMessageAlreadyProcessed delegates to supabase query', async () => {
  let called = false;
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        limit() {
          called = true;
          return Promise.resolve({ data: [{ id: '1' }], error: null });
        },
      };
    },
  };

  const yes = await inboundMessageAlreadyProcessed(supabase, 'wamid-x');
  assert.equal(yes, true);
  assert.equal(called, true);
});
