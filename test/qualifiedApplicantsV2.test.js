const test = require('node:test');
const assert = require('node:assert/strict');

const {
  __qualifiedApplicantsV2: {
    filterReusableDemandLeads,
    getInitialPipelineStageId,
    mapUrgencyToDemandCatalog,
    syncLeadDemandProfile,
  },
} = require('../services/leadAutomation');

function withEnv(values, fn) {
  const before = {};
  for (const [key, value] of Object.entries(values)) {
    before[key] = process.env[key];
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of Object.entries(before)) {
        if (value == null) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test('flag OFF preserves reusable leads without querying V2 tables', async () => {
  await withEnv({ PERSEO_QUALIFIED_APPLICANTS_V2: null }, async () => {
    let queried = false;
    const supabase = {
      from() {
        queried = true;
        throw new Error('must not query');
      },
    };
    const leads = [{ id: 'lead-1', lead_type: 'demand' }];
    assert.deepEqual(await filterReusableDemandLeads(supabase, leads), leads);
    assert.equal(queried, false);
  });
});

test('V2 reuse excludes resolved and closed demand leads', async () => {
  await withEnv({ PERSEO_QUALIFIED_APPLICANTS_V2: 'true' }, async () => {
    const supabase = {
      from(table) {
        assert.equal(table, 'lead_demand_profiles');
        return {
          select() { return this; },
          in() {
            return Promise.resolve({
              data: [
                { lead_id: 'resolved', qualified_applicant_status: 'resolved' },
                { lead_id: 'closed', qualified_applicant_status: 'closed' },
                { lead_id: 'active', qualified_applicant_status: 'active' },
              ],
              error: null,
            });
          },
        };
      },
    };
    const result = await filterReusableDemandLeads(supabase, [
      { id: 'resolved', lead_type: 'demand' },
      { id: 'closed', lead_type: 'demand' },
      { id: 'active', lead_type: 'demand' },
      { id: 'supply', lead_type: 'supply' },
    ]);
    assert.deepEqual(result.map((lead) => lead.id), ['active', 'supply']);
  });
});

test('V2 initial stage uses an active demand qualification stage', async () => {
  await withEnv({ PERSEO_QUALIFIED_APPLICANTS_V2: 'true' }, async () => {
    const calls = [];
    const supabase = {
      from(table) {
        assert.equal(table, 'pipeline_stages');
        const filters = {};
        const query = {
          select() { return query; },
          eq(key, value) { filters[key] = value; return query; },
          is(key, value) { filters[key] = value; return query; },
          order() { return query; },
          limit() { return query; },
          async maybeSingle() {
            calls.push({ ...filters });
            if (filters.code === 'contact_qualification') {
              return { data: { id: 'stage-qualified' }, error: null };
            }
            return { data: null, error: null };
          },
        };
        return query;
      },
    };
    assert.equal(
      await getInitialPipelineStageId(supabase, 'demand'),
      'stage-qualified',
    );
    assert.equal(calls[0].is_active, true);
    assert.equal(calls[0].lead_type, 'demand');
  });
});

test('PERSEO profile sync never invents currency, zones, or property type', async () => {
  await withEnv(
    {
      PERSEO_QUALIFIED_APPLICANTS_V2: 'true',
      PERSEO_QUALIFIED_APPLICANTS_PERSEO_GATE: null,
    },
    async () => {
      const calls = [];
      const supabase = {
        async rpc(name, args) {
          calls.push({ name, args });
          if (name === 'upsert_lead_demand_profile') {
            return { data: 'profile-1', error: null };
          }
          return { data: { ok: false, enforced: false }, error: null };
        },
      };
      await syncLeadDemandProfile(
        supabase,
        {
          id: 'lead-1',
          lead_type: 'demand',
          interested_in_operation: 'rent',
          budget_min: 15000,
          budget_max: 22000,
          notes_summary: 'Busca casa con patio para dos mascotas',
        },
        { urgency: '1-3' },
      );
      const patch = calls[0].args.p_patch;
      assert.equal(patch.budget_period, 'monthly');
      assert.equal(patch.demand_urgency_code, 'high_1_3_months');
      assert.equal('budget_currency' in patch, false);
      assert.equal('preferred_zone_ids' in patch, false);
      assert.equal('property_types' in patch.requirement_data, false);
      assert.equal(calls[1].name, 'assert_qualified_demand_gate');
    },
  );
});

test('urgency mapping rejects unknown labels', () => {
  assert.equal(mapUrgencyToDemandCatalog('urgente'), 'immediate_0_30_days');
  assert.equal(mapUrgencyToDemandCatalog('sin_dato'), null);
});
