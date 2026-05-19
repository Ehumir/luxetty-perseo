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
    },
  };
}

module.exports = {
  isDeterministicMode,
  applyDeterministicEnv,
  applyArgosSimulationEnv,
};
