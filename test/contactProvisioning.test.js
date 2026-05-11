const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureContactForConversationCore } = require('../services/contactProvisioning');

function createSupabaseMock({
  existingById = null,
  existingByWhatsapp = [],
  existingByPhone = [],
  existingByOr = [],
  createdContact = null,
}) {
  const state = {
    updates: [],
    inserts: [],
    orFilters: [],
  };

  function contactsQuery() {
    const query = {
      mode: 'select',
      filters: [],
      payload: null,
      select() {
        if (this.mode !== 'insert') this.mode = 'select';
        return this;
      },
      update(payload) {
        this.mode = 'update';
        this.payload = payload;
        return this;
      },
      insert(payload) {
        this.mode = 'insert';
        this.payload = payload;
        state.inserts.push(payload);
        return this;
      },
      eq(key, value) {
        this.filters.push({ key, value });
        if (this.mode === 'update') {
          state.updates.push({ payload: this.payload, filters: this.filters });
          return Promise.resolve({ data: null, error: null });
        }
        return this;
      },
      or(value) {
        state.orFilters.push(value);
        this.filters.push({ key: 'or', value });
        return this;
      },
      maybeSingle: async function maybeSingle() {
        const idFilter = this.filters.find((f) => f.key === 'id');
        if (idFilter) {
          if (existingById && existingById.id === idFilter.value) return { data: existingById, error: null };
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
      single: async function single() {
        if (this.mode === 'insert') {
          return { data: createdContact || { id: 'new-contact-id', ...this.payload }, error: null };
        }
        return { data: null, error: null };
      },
      limit: function limit() {
        const eqWhatsapp = this.filters.find((f) => f.key === 'whatsapp');
        if (eqWhatsapp) return Promise.resolve({ data: existingByWhatsapp, error: null });
        const eqPhone = this.filters.find((f) => f.key === 'phone');
        if (eqPhone) return Promise.resolve({ data: existingByPhone, error: null });
        const hasOr = this.filters.find((f) => f.key === 'or');
        if (hasOr) return Promise.resolve({ data: existingByOr, error: null });
        return Promise.resolve({ data: [], error: null });
      },
    };
    return query;
  }

  return {
    state,
    from(table) {
      if (table !== 'contacts') {
        throw new Error(`unexpected table: ${table}`);
      }
      return contactsQuery();
    },
  };
}

test('reutiliza contacto existente por variantes de WhatsApp normalizado y vincula conversation', async () => {
  const existing = {
    id: 'contact-1',
    first_name: 'Cliente',
    last_name: null,
    full_name: null,
    phone: null,
    whatsapp: null,
    phone_normalized: null,
    whatsapp_normalized: null,
  };
  const supabase = createSupabaseMock({
    existingByWhatsapp: [],
    existingByPhone: [],
    existingByOr: [existing],
  });

  const events = [];
  const metaUpdates = [];

  const contactId = await ensureContactForConversationCore({
    supabase,
    conversationRow: { id: 'conv-1', contact_id: null },
    state: {},
    phone: '5218112345678',
    waName: null,
    source: 'whatsapp',
    saveConversationEvent: async (conversationId, type, payload) => {
      events.push({ conversationId, type, payload });
    },
    updateConversationMeta: async (conversationId, payload) => {
      metaUpdates.push({ conversationId, payload });
    },
  });

  assert.equal(contactId, 'contact-1');
  assert.equal(metaUpdates.some((u) => u.payload.contact_id === 'contact-1'), true);
  assert.equal(events.some((e) => e.type === 'contact_reused'), true);
  assert.equal(supabase.state.orFilters.length > 0, true);
  const orFilter = supabase.state.orFilters[0];
  assert.match(orFilter, /5218112345678/);
  assert.match(orFilter, /528112345678/);
  assert.match(orFilter, /\+528112345678/);
  assert.match(orFilter, /8112345678/);
});

test('crea contacto provisional con placeholder Cliente y rechaza nombre inválido', async () => {
  const supabase = createSupabaseMock({
    existingByWhatsapp: [],
    existingByPhone: [],
    existingByOr: [],
    createdContact: { id: 'contact-new' },
  });
  const events = [];
  const metaUpdates = [];

  const contactId = await ensureContactForConversationCore({
    supabase,
    conversationRow: { id: 'conv-2', contact_id: null },
    state: { full_name: 'El usuario envió una imagen' },
    phone: '+52 81 1234 5678',
    waName: null,
    source: 'whatsapp',
    saveConversationEvent: async (conversationId, type, payload) => {
      events.push({ conversationId, type, payload });
    },
    updateConversationMeta: async (conversationId, payload) => {
      metaUpdates.push({ conversationId, payload });
    },
  });

  assert.equal(contactId, 'contact-new');
  assert.equal(supabase.state.inserts.length, 1);
  assert.equal(supabase.state.inserts[0].first_name, 'Cliente');
  assert.equal(supabase.state.inserts[0].name_source, 'auto_placeholder');
  assert.equal(events.some((e) => e.type === 'contact_name_rejected'), true);
  assert.equal(events.some((e) => e.type === 'contact_created'), true);
  assert.equal(metaUpdates.some((u) => u.payload.contact_id === 'contact-new'), true);
});

test('enriquece placeholder con nombre útil y registra contact_provisional_enriched', async () => {
  const existing = {
    id: 'contact-3',
    first_name: 'Cliente',
    last_name: null,
    full_name: null,
    phone: '5218112345678',
    whatsapp: '5218112345678',
    phone_normalized: '5218112345678',
    whatsapp_normalized: '5218112345678',
  };
  const supabase = createSupabaseMock({
    existingByWhatsapp: [existing],
  });
  const events = [];

  const contactId = await ensureContactForConversationCore({
    supabase,
    conversationRow: { id: 'conv-3', contact_id: null },
    state: {},
    phone: '5218112345678',
    waName: 'Mariana Ruiz',
    source: 'whatsapp',
    saveConversationEvent: async (conversationId, type, payload) => {
      events.push({ conversationId, type, payload });
    },
    updateConversationMeta: async () => {},
  });

  assert.equal(contactId, 'contact-3');
  assert.equal(supabase.state.updates.length, 1);
  assert.equal(supabase.state.updates[0].payload.first_name, 'Mariana');
  assert.equal(supabase.state.updates[0].payload.last_name, 'Ruiz');
  assert.equal(events.some((e) => e.type === 'contact_provisional_enriched'), true);
});

test('no reemplaza nombre humano bueno por frase inválida', async () => {
  const existing = {
    id: 'contact-4',
    first_name: 'Carlos',
    last_name: 'Perez',
    full_name: null,
    phone: '5218112345678',
    whatsapp: '5218112345678',
    phone_normalized: '5218112345678',
    whatsapp_normalized: '5218112345678',
  };
  const supabase = createSupabaseMock({
    existingByWhatsapp: [existing],
  });
  const events = [];

  const contactId = await ensureContactForConversationCore({
    supabase,
    conversationRow: { id: 'conv-4', contact_id: existing.id },
    state: { full_name: 'El usuario envió un sticker' },
    phone: '5218112345678',
    waName: null,
    source: 'whatsapp',
    saveConversationEvent: async (conversationId, type, payload) => {
      events.push({ conversationId, type, payload });
    },
    updateConversationMeta: async () => {},
  });

  assert.equal(contactId, 'contact-4');
  assert.equal(supabase.state.updates.length, 0);
  assert.equal(events.some((e) => e.type === 'contact_provisional_enriched'), false);
  assert.equal(events.some((e) => e.type === 'contact_name_rejected'), true);
});

