'use strict';

const { isCrmRuntimePersistentEnabled, isWaTelemetryEnabled } = require('../../../config/perseoM401Flags');

/** @type {{ crm: boolean|null, telemetry: boolean|null }} */
const probeCache = { crm: null, telemetry: null };

/**
 * ARGOS / in-memory paths only. `crmDryRun` means skip CRM writes — not memory store.
 */
function isArgosOrDryContext(ctx = {}) {
  return ctx.argosMode === true || process.env.PERSEO_ARGOS_ENABLED === 'true';
}

/**
 * Probe Supabase table availability without writes.
 * Any error → treat as unavailable (safe fallback).
 */
/**
 * HEAD count probe — does not assume an `id` column (e.g. crm_worker_heartbeats uses worker_id PK).
 */
async function probeTable(supabase, tableName) {
  if (!supabase?.from) return false;
  try {
    const { error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
    if (!error) return true;
    if (error.code === 'PGRST116') return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Detailed probe for staging diagnostics (error message, schema-cache hints).
 */
async function probeTableDetailed(supabase, tableName) {
  if (!supabase?.from) {
    return { exists: false, error: 'no_supabase_client' };
  }
  try {
    const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
    if (!error) {
      return { exists: true, count: count ?? 0, probe: 'head_count' };
    }
    const msg = String(error.message || error.code || 'unknown');
    const staleCache = msg.includes('schema cache');
    return {
      exists: false,
      error: msg,
      code: error.code,
      hint: staleCache
        ? 'PostgREST schema cache may be stale — reload API schema in Supabase dashboard or wait ~60s after migration'
        : msg.includes('does not exist')
          ? 'Table missing in public schema — verify migration applied to this project ref'
          : null,
    };
  } catch (err) {
    return { exists: false, error: String(err?.message || err) };
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
  probeTableDetailed,
  areCrmRuntimeTablesAvailable,
  isWaTelemetryTableAvailable,
  resetRuntimeTableProbeCache,
  isArgosOrDryContext,
};
