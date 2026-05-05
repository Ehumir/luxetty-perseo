'use strict';

/**
 * Fixtures controlados para la suite de regresión de PERSEO.
 * Todas las pruebas de perseoRegression.test.js importan desde aquí.
 * No modificar sin actualizar los tests correspondientes.
 */

// ─── Propiedades de referencia ───────────────────────────────────────────────

const PROPERTY_LUX_A0453 = {
  id: 'prop-lux-a0453',
  listing_id: 'LUX-A0453',
  slug: 'casa-cumbres-a0453',
  operation_type: 'sale',
  property_type: 'house',
  price: 4500000,
  currency_code: 'MXN',
  neighborhood: 'Cumbres',
  municipality: 'Monterrey',
  city: 'Monterrey',
  bedrooms: 3,
  bathrooms: 2,
  terrain_m2: 200,
  construction_m2: 180,
  agent_profile_id: 'agent-owner-a0453',
  assigned_agent_profile_id: 'agent-owner-a0453',
  is_active: true,
};

const PROPERTY_LUX_B0201 = {
  id: 'prop-lux-b0201',
  listing_id: 'LUX-B0201',
  slug: 'terreno-santa-catarina-b0201',
  operation_type: 'sale',
  property_type: 'land',
  price: 1800000,
  currency_code: 'MXN',
  neighborhood: 'Santa Catarina',
  municipality: 'Santa Catarina',
  city: 'Monterrey',
  agent_profile_id: 'agent-owner-b0201',
  assigned_agent_profile_id: 'agent-owner-b0201',
  is_active: true,
};

const PROPERTY_LUX_C0310 = {
  id: 'prop-lux-c0310',
  listing_id: 'LUX-C0310',
  slug: null, // sin slug: fuerza atención humana
  operation_type: 'sale',
  property_type: 'house',
  price: 3200000,
  currency_code: 'MXN',
  neighborhood: 'Guadalupe',
  municipality: 'Guadalupe',
  city: 'Monterrey',
  agent_profile_id: null,
  assigned_agent_profile_id: null,
  is_active: true,
};

// ─── Contactos de referencia ──────────────────────────────────────────────────

const CONTACT_ANA = {
  id: 'contact-ana',
  full_name: 'Ana García',
  whatsapp: '5218111111111',
  phone: '8111111111',
  email: null,
  assigned_agent_profile_id: null,
};

// El mismo contacto con formato diferente — para probar normalización
const CONTACT_ANA_ALT_PHONE = '528111111111'; // sin 1 de país, formato alternativo

const CONTACT_CARLOS = {
  id: 'contact-carlos',
  full_name: 'Carlos López',
  whatsapp: '5218119999999',
  phone: '8119999999',
  email: null,
  assigned_agent_profile_id: 'agent-owner-a0453',
};

// ─── Leads de referencia ──────────────────────────────────────────────────────

const LEAD_ANA_DEMAND = {
  id: 'lead-ana-demand',
  lead_type: 'demand',
  operation_type: 'sale',
  contact_id: 'contact-ana',
  conversation_id: 'conv-ana-1',
  interested_property_id: 'prop-lux-a0453',
  status: 'open',
  assigned_agent_profile_id: 'agent-owner-a0453',
  created_at: '2026-05-01T10:00:00Z',
};

const LEAD_CARLOS_OFFER = {
  id: 'lead-carlos-offer',
  lead_type: 'offer',
  operation_type: 'sale',
  contact_id: 'contact-carlos',
  conversation_id: 'conv-carlos-1',
  interested_property_id: null,
  status: 'open',
  assigned_agent_profile_id: 'agent-owner-a0453',
  created_at: '2026-05-01T11:00:00Z',
};

// ─── Conversaciones de referencia ────────────────────────────────────────────

const CONV_ANA = {
  id: 'conv-ana-1',
  phone: '5218111111111',
  channel: 'whatsapp',
  lead_id: null,
  contact_id: 'contact-ana',
  assigned_agent_profile_id: null,
};

const CONV_CARLOS = {
  id: 'conv-carlos-1',
  phone: '5218119999999',
  channel: 'whatsapp',
  lead_id: null,
  contact_id: 'contact-carlos',
  assigned_agent_profile_id: null,
};

const CONV_ANON = {
  id: 'conv-anon-1',
  phone: '5218120000001',
  channel: 'whatsapp',
  lead_id: null,
  contact_id: null,
  assigned_agent_profile_id: null,
};

// ─── Mock Supabase ────────────────────────────────────────────────────────────

/**
 * Construye un cliente Supabase simulado en memoria.
 * Acepta un estado inicial `db` y devuelve un objeto que imita la API de Supabase.
 * Soporta: from, rpc, from.select, from.insert, from.update, eq, is, or, order, limit,
 *          maybeSingle, single, then (promise-like).
 */
function buildMockSupabase(db) {
  function makeQuery(table, filters = []) {
    const api = {
      _update: null,
      _inserted: null,
      _order: null,
      _limit: null,

      select() { return api; },

      insert(payload) {
        if (!db[table]) db[table] = [];
        const rows = Array.isArray(payload) ? payload : [payload];
        const inserted = rows.map((row) => ({
          id: row.id || `${table}-${db[table].length + 1 + Math.floor(Math.random() * 9000)}`,
          created_at: row.created_at || new Date().toISOString(),
          ...row,
        }));
        db[table].push(...inserted);
        api._inserted = inserted;
        return api;
      },

      update(payload) {
        api._update = payload;
        return api;
      },

      eq(key, value) {
        filters.push((row) => row[key] === value);
        return api;
      },

      is(key, value) {
        if (value === null) filters.push((row) => row[key] == null);
        else filters.push((row) => row[key] === value);
        return api;
      },

      or() { return api; },

      order(key, opts = {}) {
        api._order = { key, asc: !!opts.ascending };
        return api;
      },

      limit(n) {
        api._limit = n;
        return api;
      },

      _applyUpdate() {
        if (!db[table]) return;
        db[table] = db[table].map((row) =>
          filters.every((fn) => fn(row)) ? { ...row, ...api._update } : row
        );
      },

      _filterRows() {
        if (!db[table]) return [];
        let rows = db[table].filter((row) => filters.every((fn) => fn(row)));
        if (api._order) {
          const { key, asc } = api._order;
          rows = [...rows].sort((a, b) => {
            if (a[key] === b[key]) return 0;
            if (a[key] == null) return 1;
            if (b[key] == null) return -1;
            return asc ? (a[key] > b[key] ? 1 : -1) : (a[key] > b[key] ? -1 : 1);
          });
        }
        if (api._limit != null) rows = rows.slice(0, api._limit);
        return rows;
      },

      async maybeSingle() {
        if (api._update) api._applyUpdate();
        const rows = api._filterRows();
        return { data: rows[0] || null, error: null };
      },

      async single() {
        if (api._inserted) return { data: api._inserted[0], error: null };
        if (api._update) api._applyUpdate();
        const rows = api._filterRows();
        return { data: rows[0] || null, error: null };
      },

      then(resolve) {
        if (api._update) {
          api._applyUpdate();
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }
        const rows = api._filterRows();
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return api;
  }

  return {
    from(table) {
      if (!db[table]) db[table] = [];
      return makeQuery(table);
    },

    async rpc(name, args) {
      if (name !== 'assign_lead_via_engine') {
        return { data: null, error: { message: `unexpected_rpc:${name}` } };
      }
      return {
        data: {
          success: true,
          lead_id: args.p_lead_id,
          assigned_agent_profile_id: 'agent-fallback-qa',
          strategy: 'fallback',
          reason: 'fallback_agent',
        },
        error: null,
      };
    },
  };
}

/**
 * Estado de base de datos mínimo para pruebas de CRM.
 * Recibe overrides para personalizar por test.
 */
function buildBaseDb(overrides = {}) {
  return {
    leads: [],
    contacts: [{ ...CONTACT_ANA }, { ...CONTACT_CARLOS }],
    conversations: [{ ...CONV_ANA }, { ...CONV_CARLOS }, { ...CONV_ANON }],
    conversation_events: [],
    conversation_messages: [],
    pipeline_stages: [
      { id: 'stage-new', code: 'new', lead_type: 'demand', is_active: true, stage_order: 1 },
      { id: 'stage-new-offer', code: 'new', lead_type: 'offer', is_active: true, stage_order: 1 },
    ],
    lead_assignments: [],
    assignment_god_modes: [],
    assignment_rules: [],
    assignment_rule_agents: [],
    assignment_settings: [
      { id: 'settings-1', is_active: true, fallback_agent_profile_id: 'agent-fallback-qa' },
    ],
    assignment_logs: [],
    ...overrides,
  };
}

module.exports = {
  // Propiedades
  PROPERTY_LUX_A0453,
  PROPERTY_LUX_B0201,
  PROPERTY_LUX_C0310,
  // Contactos
  CONTACT_ANA,
  CONTACT_ANA_ALT_PHONE,
  CONTACT_CARLOS,
  // Leads
  LEAD_ANA_DEMAND,
  LEAD_CARLOS_OFFER,
  // Conversaciones
  CONV_ANA,
  CONV_CARLOS,
  CONV_ANON,
  // Factories
  buildMockSupabase,
  buildBaseDb,
};
