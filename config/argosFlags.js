'use strict';

const packageJson = require('../package.json');

function isArgosEnabled() {
  return process.env.PERSEO_ARGOS_ENABLED === 'true';
}

function getArgosServiceSecret() {
  return String(process.env.ARGOS_SERVICE_SECRET || '').trim();
}

function assertArgosEnabled() {
  if (!isArgosEnabled()) {
    const err = new Error('PERSEO_ARGOS_ENABLED is not true');
    err.code = 'argos_disabled';
    throw err;
  }
}

function getArgosConfig() {
  return {
    enabled: isArgosEnabled(),
    serviceSecret: getArgosServiceSecret(),
    deterministicDefault: process.env.ARGOS_DETERMINISTIC_MODE_DEFAULT === 'true',
    healthPublic: process.env.ARGOS_HEALTH_PUBLIC === 'true',
    buildSha:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_SHA ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      'local',
    version: `${packageJson.version || '1.0.0'}-argos`,
    environment: process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  };
}

module.exports = {
  isArgosEnabled,
  getArgosServiceSecret,
  assertArgosEnabled,
  getArgosConfig,
};
