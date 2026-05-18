'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runArgosScenario } = require('../argos/scenarioRunner');
const { clearAllSessionsForTests } = require('../argos/argosSessionStore');
const { clearSession } = require('../conversation/v3/core/sessionStore');

const PREV = {
  argos: process.env.PERSEO_ARGOS_ENABLED,
  v3: process.env.PERSEO_V3_ENABLED,
  handoff: process.env.PERSEO_V3_HANDOFF_ENABLED,
  crmExecute: process.env.PERSEO_V3_CRM_EXECUTE,
};

function makeQuery(table, db, filters = []) {
  const api = {
    _inserted: null,
    select() {
      return api;
    },
    insert(payload) {
      const row = { id: `${table}-1`, ...payload };
      db[table].push(row);
      api._inserted = row;
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
    or() {
      return api;
    },
    limit() {
      return api;
    },
    order() {
      return api;
    },
    async maybeSingle() {
      const rows = db[table].filter((row) => filters.every((fn) => fn(row)));
      return { data: rows[0] || null, error: null };
    },
    async single() {
      if (api._inserted) return { data: api._inserted, error: null };
      return api.maybeSingle();
    },
    then(resolve, reject) {
      this.maybeSingle()
        .then((r) => resolve({ data: r.data ? [r.data] : [], error: null }))
        .catch(reject);
    },
  };
  return api;
}

function makeSupabase(db = {}) {
  return {
    from(table) {
      if (!db[table]) db[table] = [];
      return makeQuery(table, db, []);
    },
    rpc() {
      return { then: (resolve) => resolve({ data: null, error: null }) };
    },
  };
}

describe('argosDemand002Full', () => {
  before(() => {
    process.env.PERSEO_ARGOS_ENABLED = 'true';
    process.env.PERSEO_V3_ENABLED = 'true';
    process.env.PERSEO_V3_CRM_EXECUTE = 'false';
    delete process.env.PERSEO_V3_HANDOFF_ENABLED;
  });

  after(() => {
    clearAllSessionsForTests();
    process.env.PERSEO_ARGOS_ENABLED = PREV.argos;
    process.env.PERSEO_V3_ENABLED = PREV.v3;
    process.env.PERSEO_V3_HANDOFF_ENABLED = PREV.handoff;
    process.env.PERSEO_V3_CRM_EXECUTE = PREV.crmExecute;
  });

  it('DEMAND_002_FULL reaches CRM_READY with crm dry-run preview', async () => {
    const scenarioPath = path.join(
      __dirname,
      '..',
      'docs',
      'argos',
      'scenarios',
      'DEMAND_002_FULL.v1.json',
    );
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
    const supabase = makeSupabase();

    const result = await runArgosScenario({
      phone_sim: '5218100000123',
      flags: scenario.flags,
      scenario,
      supabaseRaw: supabase,
    });

    assert.equal(result.ok, true, JSON.stringify(result.violations, null, 2));
    const snap = result.final.conversation_snapshot;
    assert.equal(snap.conversation_stage, 'CRM_READY');
    assert.equal(snap.crm_ready, true);
    assert.equal(snap.known_name, 'Jorge');
    assert.equal(snap.known_budget, 5000000);
    assert.equal(snap.known_zone, 'Cumbres');
    assert.equal(snap.advisor_contact_consent, 'ACCEPTED');
    assert.equal(result.final.crm_dry_run?.skipped, false);
    assert.equal(result.final.crm_dry_run?.contact?.would_create_contact, true);
    assert.equal(result.final.crm_dry_run?.lead?.would_create_lead, true);
    assert.ok(result.final.state_transition);
    assert.ok(result.final.parser_winner);
    assert.ok(result.final.crm_gate_blockers);

    if (result.session_id) {
      clearSession(`argos:${result.session_id}`);
    }
  });
});
