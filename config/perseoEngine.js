'use strict';

/**
 * Selector de motor (`PERSEO_ENGINE`). Runtime productivo: `legacy` hasta rollout explícito.
 * `v3` reservado; `PERSEO_V3_ENABLED` documentado en F1+.
 * @see docs/sprints/perseo-v3-f0-legacy-freeze.md
 * @see docs/sprints/perseo-v3-f1-conversational-core.md
 */

const LEGACY = 'legacy';
const V3 = 'v3';

function normalizePerseoEngine(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === LEGACY) return LEGACY;
  if (s === V3) return V3;
  return LEGACY;
}

/**
 * @returns {{
 *   requested: string,
 *   effective: string,
 *   v3ReservedIgnored: boolean,
 *   v3Ignored: boolean,
 *   accidentalV3WithoutMasterFlag: boolean,
 * }}
 */
function getPerseoEngineRuntime() {
  const requested = normalizePerseoEngine(process.env.PERSEO_ENGINE);
  const v3Master = process.env.PERSEO_V3_ENABLED === 'true';
  const effective = LEGACY;
  const v3ReservedIgnored = requested === V3;
  const accidentalV3WithoutMasterFlag = requested === V3 && !v3Master;
  return {
    requested,
    effective,
    v3ReservedIgnored,
    v3Ignored: v3ReservedIgnored,
    accidentalV3WithoutMasterFlag,
  };
}

module.exports = {
  PERSEO_ENGINE_LEGACY: LEGACY,
  PERSEO_ENGINE_V3: V3,
  normalizePerseoEngine,
  getPerseoEngineRuntime,
};
