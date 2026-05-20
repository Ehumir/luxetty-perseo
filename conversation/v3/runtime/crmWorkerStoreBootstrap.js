'use strict';

const { SUPABASE_URL } = require('../../../config/env');
const { isCrmRuntimePersistentEnabled } = require('../../../config/perseoM401Flags');
const {
  isCrmWorkerAsyncEnabled,
  isCrmWorkerProcessEnabled,
} = require('../../../config/perseoM402Flags');
const { getPerseoV3Config } = require('../../../config/perseoV3Flags');
const {
  resetRuntimeTableProbeCache,
  probeTableDetailed,
  isArgosOrDryContext,
} = require('./runtimeTableProbe');
const { resolveCrmRuntimeStore } = require('./crmRuntimeStore');

function readEnvFlag(name) {
  return process.env[name] ?? null;
}

function envFlagEnabled(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function maskSupabaseHost() {
  if (!SUPABASE_URL) return null;
  try {
    return new URL(SUPABASE_URL).hostname;
  } catch {
    return 'invalid-url';
  }
}

/**
 * Startup snapshot for Railway worker — raw env strings + parsed booleans.
 */
function buildCrmWorkerEnvDiagnostics() {
  const v3 = getPerseoV3Config();
  return {
    PERSEO_ARGOS_ENABLED: readEnvFlag('PERSEO_ARGOS_ENABLED'),
    PERSEO_V3_CRM_DRY_RUN: readEnvFlag('PERSEO_V3_CRM_DRY_RUN'),
    PERSEO_V3_CRM_EXECUTE: readEnvFlag('PERSEO_V3_CRM_EXECUTE'),
    PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED: readEnvFlag('PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED'),
    PERSEO_CRM_WORKER_PROCESS_ENABLED: readEnvFlag('PERSEO_CRM_WORKER_PROCESS_ENABLED'),
    PERSEO_CRM_WORKER_ASYNC_ENABLED: readEnvFlag('PERSEO_CRM_WORKER_ASYNC_ENABLED'),
    parsed: {
      PERSEO_ARGOS_ENABLED: envFlagEnabled('PERSEO_ARGOS_ENABLED'),
      PERSEO_V3_CRM_DRY_RUN: process.env.PERSEO_V3_CRM_DRY_RUN !== 'false',
      PERSEO_V3_CRM_EXECUTE: v3.crmExecute,
      PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED: isCrmRuntimePersistentEnabled(),
      PERSEO_CRM_WORKER_PROCESS_ENABLED: isCrmWorkerProcessEnabled(),
      PERSEO_CRM_WORKER_ASYNC_ENABLED: isCrmWorkerAsyncEnabled(),
    },
    supabase_host: maskSupabaseHost(),
    supabase_configured: !!SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

/**
 * Resolve DB store for dedicated worker; fail with explicit reason when not db.
 */
async function bootstrapCrmWorkerStore(supabase) {
  resetRuntimeTableProbeCache();

  const ctx = {
    argosMode: false,
    crmDryRun: process.env.PERSEO_V3_CRM_EXECUTE !== 'true',
  };

  const tableProbe = supabase?.from
    ? await probeTableDetailed(supabase, 'crm_outbox')
    : { exists: false, error: 'no_supabase_client' };

  const resolved = await resolveCrmRuntimeStore(supabase, 'worker', ctx);
  const selectedStoreMode = resolved.mode;
  let memoryFallbackReason = resolved.memoryFallbackReason || null;

  if (selectedStoreMode === 'memory' && !memoryFallbackReason) {
    memoryFallbackReason = tableProbe.exists ? 'resolve_returned_memory_unknown' : `crm_table_probe:${tableProbe.error}`;
  }
  if (selectedStoreMode === 'memory_argos') {
    memoryFallbackReason =
      memoryFallbackReason ||
      (envFlagEnabled('PERSEO_ARGOS_ENABLED') ? 'PERSEO_ARGOS_ENABLED' : 'argos_context');
  }

  const diagnostics = {
    ...buildCrmWorkerEnvDiagnostics(),
    isArgosOrDryContext: isArgosOrDryContext(ctx),
    crm_outbox_table_probe: tableProbe,
    selectedStoreMode,
    memoryFallbackReason,
  };

  return {
    store: resolved.store,
    mode: selectedStoreMode,
    memoryFallbackReason,
    diagnostics,
  };
}

module.exports = {
  buildCrmWorkerEnvDiagnostics,
  bootstrapCrmWorkerStore,
  envFlagEnabled,
};
