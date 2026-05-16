'use strict';

const { normalizeText } = require('../../../utils/text');

/** Zonas de operación Luxetty (MTY y área metropolitana). */
const COVERED_PATTERNS = [
  /\bcumbres\b/i,
  /\bsan\s+pedro\b/i,
  /\bvalle\s+oriente\b/i,
  /\bmitras\b/i,
  /\bcarretera\s+nacional\b/i,
  /\bzona\s+sur\b/i,
  /\bgarcia\b/i,
  /\bgarc[ií]a\b/i,
  /\bvalle\s+poniente\b/i,
  /\bmonterrey\b/i,
  /\bfundidora\b/i,
  /\bmitras\b/i,
  /\bcontry\b/i,
  /\bcountry\b/i,
  /\bescobedo\b/i,
  /\bapodaca\b/i,
  /\bsanta\s+catarina\b/i,
  /\bponiente\b/i,
  /\bnorte\b/i,
  /\bsur\b/i,
];

/** Ciudades/estados claramente fuera del foco operativo. */
const OUT_OF_COVERAGE_PATTERNS = [
  /\bcdmx\b/i,
  /\bciudad\s+de\s+m[eé]xico\b/i,
  /\bvalle\s+de\s+m[eé]xico\b/i,
  /\bguadalajara\b/i,
  /\bquer[eé]taro\b/i,
  /\bcanc[uú]n\b/i,
  /\btijuana\b/i,
  /\bpuebla\b/i,
  /\ble[oó]n\b/i,
  /\baguascalientes\b/i,
  /\bestado\s+de\s+m[eé]xico\b/i,
];

/**
 * @param {string|null|undefined} locationText
 * @returns {{ status: 'unknown'|'covered'|'out_of_coverage'|'uncertain', normalizedZone: string|null }}
 */
function evaluateGeoCoverage(locationText) {
  const zone = locationText != null ? String(locationText).trim() : '';
  if (!zone) {
    return { status: 'unknown', normalizedZone: null };
  }

  const t = normalizeText(zone);

  if (OUT_OF_COVERAGE_PATTERNS.some((p) => p.test(t))) {
    return { status: 'out_of_coverage', normalizedZone: zone };
  }

  if (COVERED_PATTERNS.some((p) => p.test(t))) {
    return { status: 'covered', normalizedZone: zone };
  }

  return { status: 'uncertain', normalizedZone: zone };
}

module.exports = {
  evaluateGeoCoverage,
  COVERED_PATTERNS,
  OUT_OF_COVERAGE_PATTERNS,
};
