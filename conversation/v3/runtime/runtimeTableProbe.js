'use strict';

const { isCrmRuntimePersistentEnabled, isWaTelemetryEnabled } = require('../../../config/perseoM401Flags');

/** @type {{ crm: boolean|null, telemetry: boolean|null }} */
const probeCache = { crm: null, telemetry: null };

function isArgosOrDryContext(ctx = {}) {
  return ctx.argosMode === true || ctx.crmDryRun === true || process.env.PERSEO_ARGOS_ENABLED === 'true';
}

/**
 * Probe Supabase table availability without writes.
 * Any error → treat as unavailable (safe fallback).
 */
async function probeTable(supabase, tableName) {
  if (!supabase?.from) return false;
  try {
    const { error } = await supabase.from(tableName).select('id').limit(1);
    if (!error) return true;
    if (error.code === 'PGRST116') return true;
    return false;
  } catch {
    return false;
  }
}

async function areCrmRuntimeTablesAvailable(supabase, ctx = {}) {
  if (!isCrmRuntimePersistentEnabled()) return false;
  if (isArgosOrDryContext(ctx)) return false;
  if (probeCache.crm !== null) return probeCache.crm;
  probeCache.crm = await probeTable(supabase, 'crm_outbox');
  return probeCache.crm;
}

async function isWaTelemetryTableAvailable(supabase, ctx = {}) {
  if (!isWaTelemetryEnabled()) return false;
  if (isArgosOrDryContext(ctx)) return false;
  if (probeCache.telemetry !== null) return probeCache.telemetry;
  probeCache.telemetry = await probeTable(supabase, 'wa_operational_telemetry');
  return probeCache.telemetry;
}

function resetRuntimeTableProbeCache() {
  probeCache.crm = null;
  probeCache.telemetry = null;
}

module.exports = {
  probeTable,
  areCrmRuntimeTablesAvailable,
  isWaTelemetryTableAvailable,
  resetRuntimeTableProbeCache,
  isArgosOrDryContext,
};
