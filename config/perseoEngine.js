'use strict';

/**
 * V3-F0 — Selector de motor conversacional (solo contención).
 * `PERSEO_ENGINE=v3` queda reservado: el runtime productivo sigue siendo `legacy` hasta F1+.
 * @see docs/sprints/perseo-v3-f0-legacy-freeze.md
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
 * @returns {{ requested: string, effective: string, v3Ignored: boolean }}
 */
function getPerseoEngineRuntime() {
  const requested = normalizePerseoEngine(process.env.PERSEO_ENGINE);
  const effective = LEGACY;
  const v3Ignored = requested === V3;
  return { requested, effective, v3Ignored };
}

module.exports = {
  PERSEO_ENGINE_LEGACY: LEGACY,
  PERSEO_ENGINE_V3: V3,
  normalizePerseoEngine,
  getPerseoEngineRuntime,
};
