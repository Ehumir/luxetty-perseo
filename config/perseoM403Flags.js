'use strict';

function isRuntimeObservabilityEnabled() {
  return process.env.PERSEO_RUNTIME_OBSERVABILITY_ENABLED === 'true';
}

function isCrmDurabilityEnabled() {
  return process.env.PERSEO_CRM_DURABILITY_ENABLED === 'true';
}

function isCrmReconciliationEnabled() {
  return process.env.PERSEO_CRM_RECONCILIATION_ENABLED === 'true';
}

function isCrmReplayEnabled() {
  return process.env.PERSEO_CRM_REPLAY_ENABLED === 'true';
}

function isMediaHardeningEnabled() {
  return process.env.PERSEO_MEDIA_HARDENING_ENABLED === 'true';
}

function isRuntimeSafetyEnabled() {
  return process.env.PERSEO_RUNTIME_SAFETY_ENABLED === 'true';
}

function isReplayEngineEnabled() {
  return process.env.PERSEO_REPLAY_ENGINE_ENABLED === 'true';
}

function getRetryStormThresholdPerMinute() {
  const n = Number(process.env.PERSEO_CRM_RETRY_STORM_THRESHOLD || 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function getWorkerHeartbeatIntervalMs() {
  const n = Number(process.env.PERSEO_CRM_WORKER_HEARTBEAT_MS || 30000);
  return Number.isFinite(n) && n >= 5000 ? n : 30000;
}

function getStuckJobThresholdMs() {
  const n = Number(process.env.PERSEO_CRM_STUCK_JOB_MS || 300000);
  return Number.isFinite(n) && n >= 60000 ? n : 300000;
}

function getMaxInboundPayloadBytes() {
  const n = Number(process.env.PERSEO_MAX_INBOUND_PAYLOAD_BYTES || 16777216);
  return Number.isFinite(n) && n > 0 ? n : 16777216;
}

function getFloodWindowMs() {
  const n = Number(process.env.PERSEO_FLOOD_WINDOW_MS || 30000);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}

function getFloodMaxMessages() {
  const n = Number(process.env.PERSEO_FLOOD_MAX_MESSAGES || 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function getPerseoM403Config() {
  return {
    runtimeObservabilityEnabled: isRuntimeObservabilityEnabled(),
    crmDurabilityEnabled: isCrmDurabilityEnabled(),
    crmReconciliationEnabled: isCrmReconciliationEnabled(),
    crmReplayEnabled: isCrmReplayEnabled(),
    mediaHardeningEnabled: isMediaHardeningEnabled(),
    runtimeSafetyEnabled: isRuntimeSafetyEnabled(),
    replayEngineEnabled: isReplayEngineEnabled(),
  };
}

module.exports = {
  isRuntimeObservabilityEnabled,
  isCrmDurabilityEnabled,
  isCrmReconciliationEnabled,
  isCrmReplayEnabled,
  isMediaHardeningEnabled,
  isRuntimeSafetyEnabled,
  isReplayEngineEnabled,
  getRetryStormThresholdPerMinute,
  getWorkerHeartbeatIntervalMs,
  getStuckJobThresholdMs,
  getMaxInboundPayloadBytes,
  getFloodWindowMs,
  getFloodMaxMessages,
  getPerseoM403Config,
};
