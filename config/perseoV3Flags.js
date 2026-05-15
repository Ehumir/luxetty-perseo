'use strict';

/**
 * Feature flags oficiales V3 (F1). No activan el webhook; solo contrato y observabilidad.
 */

function splitAllowlist(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * @returns {{
 *   enabled: boolean,
 *   shadowMode: boolean,
 *   qaAllowlist: string[],
 *   logStructured: boolean,
 * }}
 */
function getPerseoV3Config() {
  return {
    enabled: process.env.PERSEO_V3_ENABLED === 'true',
    shadowMode: process.env.PERSEO_V3_SHADOW_MODE === 'true',
    qaAllowlist: splitAllowlist(process.env.PERSEO_V3_QA_ALLOWLIST),
    logStructured: process.env.PERSEO_V3_LOG === 'true',
  };
}

/**
 * F1+: cuándo el proceso **podría** enrutar a V3 (aún no cableado en index).
 * Hoy siempre false hasta integración explícita.
 */
function shouldRouteInboundToV3Core() {
  const c = getPerseoV3Config();
  const requested = String(process.env.PERSEO_ENGINE || '').trim().toLowerCase() === 'v3';
  return !!(c.enabled && requested);
}

module.exports = {
  getPerseoV3Config,
  shouldRouteInboundToV3Core,
};
