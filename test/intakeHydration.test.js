'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { extractBridgeToken } = require('../services/intake/extractBridgeToken');
const {
  parseConversationContext,
  isWithinGateWindow,
} = require('../services/intake/conversationContextSchema');
const intakeHydration = require('../services/intake/intakeHydration');

const LEAD_ID = 'a1925bbb-0eb0-4a17-a889-a991ba11a8f4';
const CONTACT_ID = '44361333-619a-4510-b8df-d9792b32a63b';
const INTAKE_ID = '944987dc-2245-4a5b-b321-60eb7d906eaa';
const PROPERTY_ID = '332a2801-572d-4c59-94a8-2e453204d2e1';
const BRIDGE_TOKEN = '57dfc027dcdb4b239071ed2a74c83dd8';
const PHONE = '5218199971001';
const PHONE_RAW = '528199971001';

const PREV_FLAG = process.env.PERSEO_APA_INTAKE_HYDRATION;
const PREV_ALLOWLIST = process.env.PERSEO_V3_QA_ALLOWLIST;
const QA_ALLOWLIST = `${PHONE},5218181877351`;

function recentIso(hoursAgo = 1) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function expiredIso(hoursAgo = 72) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function baseContext(overrides = {}) {
  return {
    intake_id: INTAKE_ID,
    landing_key: 'property_demand',
    landing_slug: '/propiedad/demo',
    capture_channel: 'property_landing',
    lead_type: 'demand',
    lead_id: LEAD_ID,
    contact_id: CONTACT_ID,
    identity: { full_name: 'Smoke Intake', whatsapp: PHONE_RAW },
    intent: { primary: 'request_info', label: 'Solicitar información' },
    campaign: { utm_source: 'smoke' },
    answers: { full_name: 'Smoke Intake', whatsapp: PHONE_RAW, intent: 'request_info' },
    property: {
      property_id: PROPERTY_ID,
      slug: 'demo',
      listing_id: 'LUX-A0462',
    },
    crm: { solicitud_created: true, contact_reused: false, lead_reused: false },
    perseo: {
      entry_type: 'property_ad',
      requires_solicitud: true,
      gate_window_hours: 48,
    },
    bridge_token: BRIDGE_TOKEN,
    intake_completed_at: recentIso(2),
    ...overrides,
  };
}

function makeSupabaseFixtures({ intakeRows = [], contactRows = [] } = {}) {
  const updates = [];

  return {
    updates,
    client: {
      from(table) {
        const state = { filters: [], order: null, limit: null };

        const builder = {
          select() {
            return builder;
          },
          eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
          },
          in(column, values) {
            state.filters.push({ op: 'in', column, values });
            return builder;
          },
          not(column, _op, value) {
            state.filters.push({ op: 'not', column, value });
            return builder;
          },
          gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
          },
          order(column, opts) {
            state.order = { column, opts };
            return builder;
          },
          limit(n) {
            state.limit = n;
            return builder;
          },
          update(payload) {
            return {
              eq(column, value) {
                updates.push({ table, payload, column, value });
                return {
                  in(column2, values) {
                    updates[updates.length - 1].in = { column: column2, values };
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
          then(resolve, reject) {
            try {
              if (table === 'intake_submissions' && updates.length === 0) {
                let rows = [...intakeRows];
                for (const f of state.filters) {
                  if (f.op === 'eq') {
                    rows = rows.filter((r) => r[f.column] === f.value);
                  }
                  if (f.op === 'in') {
                    rows = rows.filter((r) => f.values.includes(r[f.column]));
                  }
                  if (f.op === 'not' && f.column === 'lead_id') {
                    rows = rows.filter((r) => r.lead_id != null);
                  }
                  if (f.op === 'gte' && f.column === 'created_at') {
                    rows = rows.filter((r) => r.created_at >= f.value);
                  }
                }
                if (state.order?.column) {
                  const asc = state.order.opts?.ascending === true;
                  rows.sort((a, b) =>
                    asc
                      ? String(a[state.order.column]).localeCompare(String(b[state.order.column]))
                      : String(b[state.order.column]).localeCompare(String(a[state.order.column])),
                  );
                }
                if (state.limit != null) rows = rows.slice(0, state.limit);
                resolve({ data: rows, error: null });
                return;
              }
              if (table === 'contacts') {
                let rows = [...contactRows];
                for (const f of state.filters) {
                  if (f.op === 'eq') rows = rows.filter((r) => r[f.column] === f.value);
                }
                if (state.limit != null) rows = rows.slice(0, state.limit);
                resolve({ data: rows, error: null });
                return;
              }
              resolve({ data: [], error: null });
            } catch (err) {
              reject(err);
            }
          },
        };

        return builder;
      },
    },
  };
}

describe('extractBridgeToken', () => {
  it('extrae token desde query intake=', () => {
    const token = extractBridgeToken({
      text: 'Hola, completé el formulario https://luxetty.com/propiedad/demo?intake=57dfc027dcdb4b239071ed2a74c83dd8',
    });
    assert.equal(token, BRIDGE_TOKEN);
  });
});

describe('intakeHydration', () => {
  beforeEach(() => {
    process.env.PERSEO_APA_INTAKE_HYDRATION = 'true';
    process.env.PERSEO_V3_QA_ALLOWLIST = QA_ALLOWLIST;
  });

  afterEach(() => {
    if (PREV_FLAG === undefined) delete process.env.PERSEO_APA_INTAKE_HYDRATION;
    else process.env.PERSEO_APA_INTAKE_HYDRATION = PREV_FLAG;
    if (PREV_ALLOWLIST === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
    else process.env.PERSEO_V3_QA_ALLOWLIST = PREV_ALLOWLIST;
  });

  it('flag off = no-op', async () => {
    process.env.PERSEO_APA_INTAKE_HYDRATION = 'false';
    const turn = await intakeHydration.tryIntakeHydrationTurn({
      supabase: null,
      phone: PHONE,
      text: `intake=${BRIDGE_TOKEN}`,
    });
    assert.equal(turn.handled, false);
    assert.equal(turn.disabled, true);
  });

  it('flag on pero teléfono fuera de allowlist = no-op legacy', async () => {
    process.env.PERSEO_V3_QA_ALLOWLIST = '5218119086196';
    const events = [];
    const turn = await intakeHydration.tryIntakeHydrationTurn({
      supabase: makeSupabaseFixtures({
        intakeRows: [
          {
            id: INTAKE_ID,
            landing_key: 'property_demand',
            lead_id: LEAD_ID,
            contact_id: CONTACT_ID,
            bridge_token: BRIDGE_TOKEN,
            conversation_context: baseContext(),
            status: 'completed',
            created_at: recentIso(1),
          },
        ],
      }).client,
      phone: PHONE,
      text: `intake=${BRIDGE_TOKEN}`,
      logEvent: (name, payload) => events.push({ name, payload }),
    });
    assert.equal(turn.handled, false);
    assert.equal(turn.skipped_not_allowlisted, true);
    assert.equal(events.some((e) => e.name === 'apa_intake_skipped_not_allowlisted'), true);
  });

  it('hidrata por bridge_token', async () => {
    const { client, updates } = makeSupabaseFixtures({
      intakeRows: [
        {
          id: INTAKE_ID,
          landing_key: 'property_demand',
          lead_id: LEAD_ID,
          contact_id: CONTACT_ID,
          bridge_token: BRIDGE_TOKEN,
          conversation_context: baseContext(),
          status: 'completed',
          created_at: recentIso(1),
        },
      ],
    });

    const turn = await intakeHydration.tryIntakeHydrationTurn({
      supabase: client,
      phone: PHONE,
      text: `Hola intake=${BRIDGE_TOKEN}`,
      logEvent: () => {},
    });

    assert.equal(turn.handled, true);
    assert.equal(turn.resolution, 'bridge_token');
    assert.equal(turn.skipLegacyCrm, true);
    assert.equal(turn.statePatch.lead_id, LEAD_ID);
    assert.equal(turn.statePatch.contact_id, CONTACT_ID);
    assert.equal(turn.statePatch.full_name, 'Smoke Intake');
    assert.equal(turn.statePatch.property_solicitud_verified, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].payload.status, 'bridged');
  });

  it('hidrata por fallback 48h', async () => {
    const { client } = makeSupabaseFixtures({
      contactRows: [{ id: CONTACT_ID, whatsapp_normalized: PHONE }],
      intakeRows: [
        {
          id: INTAKE_ID,
          landing_key: 'cumbres_supply',
          lead_id: LEAD_ID,
          contact_id: CONTACT_ID,
          bridge_token: 'abc123abc123abc123abc123abc123ab',
          conversation_context: baseContext({
            landing_key: 'cumbres_supply',
            lead_type: 'supply',
            property: null,
            crm: { solicitud_created: false },
            perseo: {
              entry_type: 'seller_capture_ad',
              requires_solicitud: false,
              gate_window_hours: 48,
            },
            answers: {
              full_name: 'Propietario',
              whatsapp: PHONE_RAW,
              zone_or_neighborhood: 'Cumbres Elite',
              operation_intent: 'sale',
            },
          }),
          status: 'completed',
          created_at: recentIso(3),
        },
      ],
    });

    const turn = await intakeHydration.tryIntakeHydrationTurn({
      supabase: client,
      phone: PHONE,
      text: 'Hola, quiero prevaluación en Cumbres',
      parsedSignals: { __entry_point_meta: { entry_type: 'seller_capture_ad' } },
      logEvent: () => {},
    });

    assert.equal(turn.handled, true);
    assert.equal(turn.resolution, 'fallback_48h');
    assert.equal(turn.statePatch.lead_flow, 'offer');
    assert.equal(turn.statePatch.intake_source, 'cumbres_supply');
    assert.equal(turn.skipLegacyCrm, false);
  });

  it('no hidrata intakes vencidos', async () => {
    const { client } = makeSupabaseFixtures({
      intakeRows: [
        {
          id: INTAKE_ID,
          landing_key: 'property_demand',
          lead_id: LEAD_ID,
          contact_id: CONTACT_ID,
          bridge_token: BRIDGE_TOKEN,
          conversation_context: baseContext({
            intake_completed_at: expiredIso(80),
          }),
          status: 'completed',
          created_at: expiredIso(80),
        },
      ],
    });

    const turn = await intakeHydration.tryIntakeHydrationTurn({
      supabase: client,
      phone: PHONE,
      text: `intake=${BRIDGE_TOKEN}`,
      logEvent: () => {},
    });

    assert.equal(turn.handled, false);
    assert.equal(turn.expired, true);
  });

  it('genera skipLegacyCrm=true si ya existe solicitud', async () => {
    const patch = intakeHydration.mapConversationContextToAiState(
      parseConversationContext(baseContext()).context,
    );
    assert.equal(patch.property_solicitud_verified, true);

    const turn = await intakeHydration.tryIntakeHydrationTurn({
      supabase: makeSupabaseFixtures({
        intakeRows: [
          {
            id: INTAKE_ID,
            landing_key: 'property_demand',
            lead_id: LEAD_ID,
            contact_id: CONTACT_ID,
            bridge_token: BRIDGE_TOKEN,
            conversation_context: baseContext(),
            status: 'completed',
            created_at: recentIso(1),
          },
        ],
      }).client,
      phone: PHONE,
      text: `intake=${BRIDGE_TOKEN}`,
      logEvent: () => {},
    });

    assert.equal(turn.skipLegacyCrm, true);
  });

  it('no duplica lead (skipLegacyCrm bloquea CRM legacy)', async () => {
    const turn = await intakeHydration.tryIntakeHydrationTurn({
      supabase: makeSupabaseFixtures({
        intakeRows: [
          {
            id: INTAKE_ID,
            landing_key: 'medical_consultorios',
            lead_id: LEAD_ID,
            contact_id: CONTACT_ID,
            bridge_token: BRIDGE_TOKEN,
            conversation_context: baseContext({
              landing_key: 'medical_consultorios',
              lead_type: 'supply',
              property: null,
              crm: { solicitud_created: true },
              perseo: {
                entry_type: 'buyer_search',
                requires_solicitud: false,
                gate_window_hours: 48,
              },
              answers: {
                full_name: 'Dr Smoke',
                whatsapp: PHONE_RAW,
                specialty: 'Cardiología',
                location_interest: 'sikara',
              },
            }),
            status: 'completed',
            created_at: recentIso(1),
          },
        ],
      }).client,
      phone: PHONE,
      text: `intake=${BRIDGE_TOKEN}`,
      logEvent: () => {},
    });

    assert.equal(turn.handled, true);
    assert.equal(turn.skipLegacyCrm, true);
    assert.equal(turn.statePatch.lead_id, LEAD_ID);
    assert.equal(turn.statePatch.intake_source, 'medical_consultorios');
  });

  it('respeta property_demand con interested_property_id', () => {
    const parsed = parseConversationContext(baseContext());
    const patch = intakeHydration.mapConversationContextToAiState(parsed.context);
    assert.equal(patch.lead_flow, 'demand');
    assert.equal(patch.interested_property_id, PROPERTY_ID);
    assert.equal(patch.property_code, 'LUX-A0462');
    assert.equal(patch.entry_point_last.entry_type, 'property_ad');
  });

  it('respeta cumbres_supply', () => {
    const parsed = parseConversationContext(
      baseContext({
        landing_key: 'cumbres_supply',
        lead_type: 'supply',
        property: null,
        perseo: { entry_type: 'seller_capture_ad', gate_window_hours: 48 },
      }),
    );
    const patch = intakeHydration.mapConversationContextToAiState(parsed.context);
    assert.equal(patch.lead_flow, 'offer');
    assert.equal(patch.intake_source, 'cumbres_supply');
  });

  it('respeta medical_consultorios', () => {
    const parsed = parseConversationContext(
      baseContext({
        landing_key: 'medical_consultorios',
        lead_type: 'supply',
        property: null,
        perseo: { entry_type: 'buyer_search', gate_window_hours: 48 },
        answers: {
          full_name: 'Dr Smoke',
          specialty: 'Cardiología',
          location_interest: 'sikara',
        },
      }),
    );
    const patch = intakeHydration.mapConversationContextToAiState(parsed.context);
    assert.equal(patch.intake_source, 'medical_consultorios');
    assert.equal(patch.entry_point_last.entry_type, 'buyer_search');
  });

  it('isWithinGateWindow rechaza timestamps vencidos', () => {
    assert.equal(isWithinGateWindow(recentIso(2), 48), true);
    assert.equal(isWithinGateWindow(expiredIso(80), 48), false);
  });
});
