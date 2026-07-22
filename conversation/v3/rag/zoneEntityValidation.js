'use strict';

/**
 * RC11 — Validación entidad zona (bloquea colonias inventadas).
 */

const { isRagRc11ZoneEntityValidationEnabled } = require('../../../config/accP0Flags');
const { chunkScore } = require('./ragRetrievalMetrics');

/**
 * @returns {{ valid: boolean, reason: string|null, top: object|null }}
 */
function validateZoneEntityMatch(text, chunks = []) {
  if (!isRagRc11ZoneEntityValidationEnabled()) {
    return { valid: true, reason: 'flag_off', top: null };
  }

  const t = String(text || '');
  const looksZone = /\bzona\b|\bcolonia\b|\bubicaci[oó]n\b/i.test(t);
  if (!looksZone) {
    return { valid: true, reason: null, top: null };
  }

  const list = Array.isArray(chunks) ? [...chunks] : [];
  list.sort((a, b) => chunkScore(b) - chunkScore(a));
  const top = list[0] || null;

  if (/inexistent|inventad|xyz-?\d+/i.test(t)) {
    const score = top ? chunkScore(top) : 0;
    if (!top || score < 0.72) {
      return { valid: false, reason: 'inexistent_zone', top };
    }
  }

  if (!top) {
    return { valid: false, reason: 'no_zone_chunk', top: null };
  }

  const domain = top.registry_domain_code || top.source_type;
  if (domain !== 'zones' && domain !== 'properties' && domain !== 'zone') {
    return { valid: false, reason: 'wrong_domain_for_zone', top };
  }

  if (chunkScore(top) < 0.45) {
    return { valid: false, reason: 'low_zone_confidence', top };
  }

  return { valid: true, reason: null, top };
}

module.exports = {
  validateZoneEntityMatch,
};
