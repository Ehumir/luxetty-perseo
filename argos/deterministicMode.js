'use strict';

/**
 * When deterministic_mode is on, V3 may still call OpenAI in some paths;
 * this module documents the flag for gates/trace and future stubs.
 */
function isDeterministicMode(flags = {}) {
  if (flags.deterministic_mode === true) return true;
  return process.env.ARGOS_DETERMINISTIC_MODE_DEFAULT === 'true';
}

function applyDeterministicEnv(flags = {}) {
  if (!isDeterministicMode(flags)) return { applied: false };
  return {
    applied: true,
    note: 'deterministic_mode_active',
  };
}

/**
 * ARGOS simula el mismo stack V3+F3 que producción QA (handoff ON por defecto).
 * @returns {{ restore: () => void, handoffEnabled: boolean }}
 */
function applyArgosSimulationEnv(flags = {}) {
  const prev = {
    handoff: process.env.PERSEO_V3_HANDOFF_ENABLED,
    mediaIntake: process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED,
    policy: process.env.PERSEO_POLICY_ENGINE_ENABLED,
    planner: process.env.PERSEO_MESSAGE_PLANNER_ENABLED,
    mediaReal: process.env.PERSEO_MEDIA_REAL_V1_ENABLED,
    crmFoundation: process.env.PERSEO_CRM_EXECUTE_FOUNDATION_ENABLED,
    resilience: process.env.PERSEO_RESILIENCE_V1_ENABLED,
    humanityWave2: process.env.PERSEO_HUMANITY_WAVE2_ENABLED,
    waHardening: process.env.PERSEO_WA_HARDENING_V2_ENABLED,
    crmRuntime: process.env.PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED,
    mediaRuntime: process.env.PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED,
    understandingRuntime: process.env.PERSEO_UNDERSTANDING_RUNTIME_ENABLED,
    resilienceRuntime: process.env.PERSEO_RESILIENCE_RUNTIME_ENABLED,
    waTelemetry: process.env.PERSEO_WA_TELEMETRY_ENABLED,
    learningRuntime: process.env.PERSEO_LEARNING_RUNTIME_ENABLED,
    policyRuntime: process.env.PERSEO_POLICY_RUNTIME_ENABLED,
  };
  const handoffOn = flags.v3_handoff_enabled !== false;
  process.env.PERSEO_V3_HANDOFF_ENABLED = handoffOn ? 'true' : 'false';
  const mediaOn = flags.media_intake_v1 === true;
  if (mediaOn) process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED = 'true';
  else if (prev.mediaIntake === undefined) delete process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED;

  if (flags.policy_engine === true) process.env.PERSEO_POLICY_ENGINE_ENABLED = 'true';
  else if (flags.policy_engine === false) process.env.PERSEO_POLICY_ENGINE_ENABLED = 'false';

  if (flags.message_planner === true) process.env.PERSEO_MESSAGE_PLANNER_ENABLED = 'true';
  else if (flags.message_planner === false) process.env.PERSEO_MESSAGE_PLANNER_ENABLED = 'false';

  const setTriFlag = (key, val) => {
    if (val === true) process.env[key] = 'true';
    else if (val === false) process.env[key] = 'false';
  };
  setTriFlag('PERSEO_MEDIA_REAL_V1_ENABLED', flags.media_real_v1);
  setTriFlag('PERSEO_CRM_EXECUTE_FOUNDATION_ENABLED', flags.crm_execute_foundation);
  setTriFlag('PERSEO_RESILIENCE_V1_ENABLED', flags.resilience_v1);
  setTriFlag('PERSEO_HUMANITY_WAVE2_ENABLED', flags.humanity_wave2);
  setTriFlag('PERSEO_WA_HARDENING_V2_ENABLED', flags.wa_hardening_v2);
  setTriFlag('PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED', flags.crm_runtime_persistent);
  setTriFlag('PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED', flags.media_runtime_production);
  setTriFlag('PERSEO_UNDERSTANDING_RUNTIME_ENABLED', flags.understanding_runtime);
  setTriFlag('PERSEO_RESILIENCE_RUNTIME_ENABLED', flags.resilience_runtime);
  setTriFlag('PERSEO_WA_TELEMETRY_ENABLED', flags.wa_telemetry);
  setTriFlag('PERSEO_LEARNING_RUNTIME_ENABLED', flags.learning_runtime);
  setTriFlag('PERSEO_POLICY_RUNTIME_ENABLED', flags.policy_runtime);

  return {
    handoffEnabled: handoffOn,
    mediaIntakeEnabled: mediaOn,
    restore() {
      if (prev.handoff === undefined) delete process.env.PERSEO_V3_HANDOFF_ENABLED;
      else process.env.PERSEO_V3_HANDOFF_ENABLED = prev.handoff;
      if (prev.mediaIntake === undefined) delete process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED;
      else process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED = prev.mediaIntake;
      if (prev.policy === undefined) delete process.env.PERSEO_POLICY_ENGINE_ENABLED;
      else process.env.PERSEO_POLICY_ENGINE_ENABLED = prev.policy;
      if (prev.planner === undefined) delete process.env.PERSEO_MESSAGE_PLANNER_ENABLED;
      else process.env.PERSEO_MESSAGE_PLANNER_ENABLED = prev.planner;
      const restoreTri = (key, val) => {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      };
      restoreTri('PERSEO_MEDIA_REAL_V1_ENABLED', prev.mediaReal);
      restoreTri('PERSEO_CRM_EXECUTE_FOUNDATION_ENABLED', prev.crmFoundation);
      restoreTri('PERSEO_RESILIENCE_V1_ENABLED', prev.resilience);
      restoreTri('PERSEO_HUMANITY_WAVE2_ENABLED', prev.humanityWave2);
      restoreTri('PERSEO_WA_HARDENING_V2_ENABLED', prev.waHardening);
      restoreTri('PERSEO_CRM_RUNTIME_PERSISTENT_ENABLED', prev.crmRuntime);
      restoreTri('PERSEO_MEDIA_RUNTIME_PRODUCTION_ENABLED', prev.mediaRuntime);
      restoreTri('PERSEO_UNDERSTANDING_RUNTIME_ENABLED', prev.understandingRuntime);
      restoreTri('PERSEO_RESILIENCE_RUNTIME_ENABLED', prev.resilienceRuntime);
      restoreTri('PERSEO_WA_TELEMETRY_ENABLED', prev.waTelemetry);
      restoreTri('PERSEO_LEARNING_RUNTIME_ENABLED', prev.learningRuntime);
      restoreTri('PERSEO_POLICY_RUNTIME_ENABLED', prev.policyRuntime);
    },
  };
}

module.exports = {
  isDeterministicMode,
  applyDeterministicEnv,
  applyArgosSimulationEnv,
};
