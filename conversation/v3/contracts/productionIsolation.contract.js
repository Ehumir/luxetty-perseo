'use strict';

const { evaluateV3PrimaryGate, getPerseoV3Config } = require('../../../config/perseoV3Flags');
const { getPerseoEngineRuntime } = require('../../../config/perseoEngine');

/**
 * Documenta el gate operativo F1: V3 en webhook solo si allowlist + maestro.
 * No lee `index.js`; refleja flags reales.
 * @returns {{
 *   operationalFlag: string,
 *   documentAliasFlag: string,
 *   engineEffective: string,
 *   v3Enabled: boolean,
 *   allowlistCount: number,
 *   defaultProductionSafe: boolean,
 *   samplePhoneBlocked: boolean,
 * }}
 */
function describeV3ProductionGate() {
  const cfg = getPerseoV3Config();
  const engine = getPerseoEngineRuntime();
  const sample = evaluateV3PrimaryGate({ phone: '5218110000000' });

  return {
    operationalFlag: 'PERSEO_V3_ENABLED',
    documentAliasFlag: 'PERSEO_CONVERSATIONAL_CORE_V3_ENABLED',
    engineEffective: engine.effective,
    v3Enabled: cfg.enabled,
    allowlistCount: cfg.qaAllowlist.length,
    defaultProductionSafe: !cfg.enabled && cfg.qaAllowlist.length === 0,
    samplePhoneBlocked: !sample.v3_primary_allowed,
  };
}

/**
 * @param {{ v3Enabled?: boolean, allowlist?: string }} [overrides]
 */
function isProductionSafeV3Config(overrides = {}) {
  const enabled =
    overrides.v3Enabled !== undefined
      ? overrides.v3Enabled
      : process.env.PERSEO_V3_ENABLED === 'true';
  const allowlistRaw =
    overrides.allowlist !== undefined ? overrides.allowlist : process.env.PERSEO_V3_QA_ALLOWLIST;
  const allowlistEmpty = !String(allowlistRaw || '').trim();
  return !enabled && allowlistEmpty;
}

module.exports = {
  describeV3ProductionGate,
  isProductionSafeV3Config,
};
