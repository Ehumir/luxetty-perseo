'use strict';

function isMediaRealV1Enabled() {
  return process.env.PERSEO_MEDIA_REAL_V1_ENABLED === 'true';
}

function isCrmExecuteFoundationEnabled() {
  return process.env.PERSEO_CRM_EXECUTE_FOUNDATION_ENABLED === 'true';
}

function isResilienceV1Enabled() {
  return process.env.PERSEO_RESILIENCE_V1_ENABLED === 'true';
}

function isHumanityWave2Enabled() {
  return process.env.PERSEO_HUMANITY_WAVE2_ENABLED === 'true';
}

function isWaHardeningV2Enabled() {
  return process.env.PERSEO_WA_HARDENING_V2_ENABLED === 'true';
}

function getPerseoM302Config() {
  return {
    mediaRealV1Enabled: isMediaRealV1Enabled(),
    crmExecuteFoundationEnabled: isCrmExecuteFoundationEnabled(),
    resilienceV1Enabled: isResilienceV1Enabled(),
    humanityWave2Enabled: isHumanityWave2Enabled(),
    waHardeningV2Enabled: isWaHardeningV2Enabled(),
  };
}

module.exports = {
  isMediaRealV1Enabled,
  isCrmExecuteFoundationEnabled,
  isResilienceV1Enabled,
  isHumanityWave2Enabled,
  isWaHardeningV2Enabled,
  getPerseoM302Config,
};
