#!/usr/bin/env node
'use strict';

require('dotenv').config();

const { supabase } = require('../services/supabaseService');
const { probeTable } = require('../conversation/v3/runtime/runtimeTableProbe');

async function main() {
  const crm = await probeTable(supabase, 'crm_outbox');
  const tel = await probeTable(supabase, 'wa_operational_telemetry');
  console.log(JSON.stringify({ crm_outbox: crm, wa_operational_telemetry: tel }, null, 2));
  process.exit(crm && tel ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
