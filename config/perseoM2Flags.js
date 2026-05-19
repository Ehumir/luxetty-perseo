'use strict';

function isPolicyEngineEnabled() {
  return process.env.PERSEO_POLICY_ENGINE_ENABLED === 'true';
}

function isMessagePlannerEnabled() {
  return process.env.PERSEO_MESSAGE_PLANNER_ENABLED === 'true';
}

function getPerseoM2Config() {
  return {
    policyEngineEnabled: isPolicyEngineEnabled(),
    messagePlannerEnabled: isMessagePlannerEnabled(),
  };
}

module.exports = {
  isPolicyEngineEnabled,
  isMessagePlannerEnabled,
  getPerseoM2Config,
};
