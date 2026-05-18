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
  };
  const handoffOn = flags.v3_handoff_enabled !== false;
  process.env.PERSEO_V3_HANDOFF_ENABLED = handoffOn ? 'true' : 'false';
  return {
    handoffEnabled: handoffOn,
    restore() {
      if (prev.handoff === undefined) delete process.env.PERSEO_V3_HANDOFF_ENABLED;
      else process.env.PERSEO_V3_HANDOFF_ENABLED = prev.handoff;
    },
  };
}

module.exports = {
  isDeterministicMode,
  applyDeterministicEnv,
  applyArgosSimulationEnv,
};
