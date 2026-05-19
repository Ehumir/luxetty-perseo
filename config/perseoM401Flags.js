'use strict';

function isCrmRuntimePersistentEnabled() {
  return process.env.PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED === 'true';
}

function isMediaRuntimeProductionEnabled() {
  return process.env.PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED === 'true';
}

function isUnderstandingRuntimeEnabled() {
  return process.env.PERSEO_UNDERSTANDING_RUNTIME_ENABLED === 'true';
}

function isResilienceRuntimeEnabled() {
  return process.env.PERSEO_RESILIENCE_RUNTIME_ENABLED === 'true';
}

function isWaTelemetryEnabled() {
  return process.env.PERSEO_WA_TELEMETRY_ENABLED === 'true';
}

function isLearningRuntimeEnabled() {
  return process.env.PERSEO_LEARNING_RUNTIME_ENABLED === 'true';
}

function isPolicyRuntimeEnabled() {
  return process.env.PERSEO_POLICY_RUNTIME_ENABLED === 'true';
}

function getPerseoM401Config() {
  return {
    crmRuntimePersistentEnabled: isCrmRuntimePersistentEnabled(),
    mediaRuntimeProductionEnabled: isMediaRuntimeProductionEnabled(),
    understandingRuntimeEnabled: isUnderstandingRuntimeEnabled(),
    resilienceRuntimeEnabled: isResilienceRuntimeEnabled(),
    waTelemetryEnabled: isWaTelemetryEnabled(),
    learningRuntimeEnabled: isLearningRuntimeEnabled(),
    policyRuntimeEnabled: isPolicyRuntimeEnabled(),
  };
}

module.exports = {
  isCrmRuntimePersistentEnabled,
  isMediaRuntimeProductionEnabled,
  isUnderstandingRuntimeEnabled,
  isResilienceRuntimeEnabled,
  isWaTelemetryEnabled,
  isLearningRuntimeEnabled,
  isPolicyRuntimeEnabled,
  getPerseoM401Config,
};
