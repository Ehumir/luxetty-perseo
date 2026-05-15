'use strict';

/**
 * Feature flags oficiales V3.
 */

function splitAllowlist(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizePhoneForAllowlist(phone) {
  return String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
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

function isPhoneOnV3Allowlist(phone) {
  const cfg = getPerseoV3Config();
  if (!cfg.enabled || !cfg.qaAllowlist.length) return false;
  const digits = normalizePhoneForAllowlist(phone);
  if (!digits) return false;
  return cfg.qaAllowlist.some((entry) => {
    const e = normalizePhoneForAllowlist(entry);
    if (!e) return false;
    return digits === e || digits.endsWith(e) || e.endsWith(digits);
  });
}

/**
 * F2: enrutamiento real solo allowlist + enabled. Resto legacy.
 */
function shouldRouteInboundToV3Core(phone) {
  return isPhoneOnV3Allowlist(phone);
}

module.exports = {
  getPerseoV3Config,
  isPhoneOnV3Allowlist,
  shouldRouteInboundToV3Core,
  normalizePhoneForAllowlist,
};
