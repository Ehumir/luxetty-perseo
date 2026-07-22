'use strict';

/**
 * RQ-4 — umbrales adaptativos por dominio.
 * Fuente canónica certificada + override vía RAG_DOMAIN_THRESHOLDS_JSON.
 */

const { isRagAdaptiveThresholdEnabled } = require('../../../config/accP0Flags');
const { DEFAULT_MIN_SCORE } = require('./ragPolicy');

/** Umbrales certificados RC-1 / RQ-4 (congelados). */
const RQ4_CERTIFIED_THRESHOLDS = {
  properties: 0.78,
  commercial_objections: 0.55,
  assignment_rules: 0.55,
  rules_atena: 0.45,
  rules_perseo: 0.45,
  zones: 0.45,
  campaigns: 0.45,
  scripts: 0.72,
};

function parseEnvThresholds() {
  const raw = process.env.RAG_DOMAIN_THRESHOLDS_JSON;
  if (!raw || !String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && n < 1) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function getDomainThresholds() {
  const env = parseEnvThresholds();
  return { ...RQ4_CERTIFIED_THRESHOLDS, ...(env || {}) };
}

/**
 * @param {string|null|undefined} domain
 * @returns {number}
 */
function getMinScoreForDomain(domain) {
  if (!isRagAdaptiveThresholdEnabled()) {
    return DEFAULT_MIN_SCORE;
  }
  const map = getDomainThresholds();
  const d = String(domain || '');
  if (d && Number.isFinite(map[d])) return map[d];
  return DEFAULT_MIN_SCORE;
}

function getThresholdAuditSnapshot() {
  const thresholds = getDomainThresholds();
  return {
    adaptive_enabled: isRagAdaptiveThresholdEnabled(),
    domain_count: Object.keys(thresholds).length,
    thresholds,
    certified: RQ4_CERTIFIED_THRESHOLDS,
    source: parseEnvThresholds() ? 'env+certified' : 'certified',
  };
}

module.exports = {
  RQ4_CERTIFIED_THRESHOLDS,
  getDomainThresholds,
  getMinScoreForDomain,
  getThresholdAuditSnapshot,
};
