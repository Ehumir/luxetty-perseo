'use strict';

function isMediaIntakeV1Enabled() {
  return process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED === 'true';
}

function getPerseoM3Config() {
  return {
    mediaIntakeV1Enabled: isMediaIntakeV1Enabled(),
  };
}

module.exports = {
  isMediaIntakeV1Enabled,
  getPerseoM3Config,
};
