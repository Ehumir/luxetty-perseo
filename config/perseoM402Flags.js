'use strict';

function isCrmWorkerAsyncEnabled() {
  return process.env.PERSEO_CRM_WORKER_ASYNC_ENABLED === 'true';
}

/** Dedicated Railway worker process (poll loop). */
function isCrmWorkerProcessEnabled() {
  return process.env.PERSEO_CRM_WORKER_PROCESS_ENABLED === 'true';
}

function isMediaRuntimeFailOpenEnabled() {
  return process.env.PERSEO_MEDIA_RUNTIME_FAIL_OPEN_ENABLED === 'true';
}

function getCrmWorkerPollMs() {
  const n = Number(process.env.PERSEO_CRM_WORKER_POLL_MS || 5000);
  return Number.isFinite(n) && n >= 1000 ? n : 5000;
}

function getCrmWorkerBatchSize() {
  const n = Number(process.env.PERSEO_CRM_WORKER_BATCH_SIZE || 5);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 20) : 5;
}

function getCrmWorkerLockTtlSec() {
  const n = Number(process.env.PERSEO_CRM_WORKER_LOCK_TTL_SEC || 120);
  return Number.isFinite(n) && n >= 30 ? n : 120;
}

function getMediaTimeoutMs(kind) {
  const defaults = { audio: 12000, image: 15000, document: 8000, pdf: 8000 };
  const key = `PERSEO_MEDIA_TIMEOUT_${String(kind || 'audio').toUpperCase()}_MS`;
  const env = process.env[key];
  if (env != null && env !== '') {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return defaults[kind] || defaults.audio;
}

function getPerseoM402Config() {
  return {
    crmWorkerAsyncEnabled: isCrmWorkerAsyncEnabled(),
    crmWorkerProcessEnabled: isCrmWorkerProcessEnabled(),
    mediaRuntimeFailOpenEnabled: isMediaRuntimeFailOpenEnabled(),
    crmWorkerPollMs: getCrmWorkerPollMs(),
    crmWorkerBatchSize: getCrmWorkerBatchSize(),
    crmWorkerLockTtlSec: getCrmWorkerLockTtlSec(),
  };
}

module.exports = {
  isCrmWorkerAsyncEnabled,
  isCrmWorkerProcessEnabled,
  isMediaRuntimeFailOpenEnabled,
  getCrmWorkerPollMs,
  getCrmWorkerBatchSize,
  getCrmWorkerLockTtlSec,
  getMediaTimeoutMs,
  getPerseoM402Config,
};
