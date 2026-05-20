'use strict';

const PHASE_FLAGS = {
  0: {},
  1: {
    PERSEO_RUNTIME_OBSERVABILITY_ENABLED: 'true',
    PERSEO_WA_TELEMETRY_ENABLED: 'true',
  },
  2: {
    PERSEO_RUNTIME_OBSERVABILITY_ENABLED: 'true',
    PERSEO_WA_TELEMETRY_ENABLED: 'true',
    PERSEO_CRM_DURABILITY_ENABLED: 'true',
    PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED: 'true',
    PERSEO_CRM_WORKER_ASYNC_ENABLED: 'true',
    PERSEO_CRM_WORKER_PROCESS_ENABLED: 'true',
    PERSEO_V3_CRM_EXECUTE: 'false',
    PERSEO_ARGOS_ENABLED: 'false',
  },
  3: {
    PERSEO_RUNTIME_OBSERVABILITY_ENABLED: 'true',
    PERSEO_WA_TELEMETRY_ENABLED: 'true',
    PERSEO_CRM_DURABILITY_ENABLED: 'true',
    PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED: 'true',
    PERSEO_CRM_WORKER_ASYNC_ENABLED: 'true',
    PERSEO_CRM_WORKER_PROCESS_ENABLED: 'true',
    PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED: 'true',
    PERSEO_MEDIA_HARDENING_ENABLED: 'true',
    PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED: 'true',
    PERSEO_V3_CRM_EXECUTE: 'false',
    PERSEO_ARGOS_ENABLED: 'false',
  },
  4: {
    PERSEO_RUNTIME_OBSERVABILITY_ENABLED: 'true',
    PERSEO_WA_TELEMETRY_ENABLED: 'true',
    PERSEO_CRM_DURABILITY_ENABLED: 'true',
    PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED: 'true',
    PERSEO_CRM_WORKER_ASYNC_ENABLED: 'true',
    PERSEO_CRM_WORKER_PROCESS_ENABLED: 'true',
    PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED: 'true',
    PERSEO_MEDIA_HARDENING_ENABLED: 'true',
    PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED: 'true',
    PERSEO_RUNTIME_SAFETY_ENABLED: 'true',
    PERSEO_REPLAY_ENGINE_ENABLED: 'true',
    PERSEO_V3_CRM_EXECUTE: 'false',
    PERSEO_ARGOS_ENABLED: 'false',
  },
};

function getStagingBaseUrl() {
  return (
    process.env.PERSEO_BASE_URL_STAGING ||
    process.env.PERSEO_BASE_URL ||
    ''
  ).replace(/\/$/, '');
}

function buildPhaseEnv(phase) {
  const p = Number(phase);
  const flags = PHASE_FLAGS[p] || {};
  return {
    ...process.env,
    ...flags,
    PERSEO_STAGING_CONFIRMED: 'true',
  };
}

function cumulativePhaseEnv(maxPhase = 4) {
  const env = { ...process.env, PERSEO_STAGING_CONFIRMED: 'true' };
  for (let i = 0; i <= maxPhase; i += 1) {
    Object.assign(env, PHASE_FLAGS[i] || {});
  }
  env.PERSEO_V3_CRM_EXECUTE = 'false';
  env.PERSEO_ARGOS_ENABLED = 'false';
  return env;
}

module.exports = {
  PHASE_FLAGS,
  getStagingBaseUrl,
  buildPhaseEnv,
  cumulativePhaseEnv,
};
