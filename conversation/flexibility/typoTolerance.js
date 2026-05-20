'use strict';

const { normalizeText } = require('../../utils/text');

/** @type {{ canonical: string, phrases?: string[], typos?: string[], token?: string }} */
const FLEX_ZONE_CATALOG = [
  {
    canonical: 'Cumbres Elite',
    phrases: ['cumbres elite', 'cumbres elit', 'cumbres elitte', 'cumbress elite'],
  },
  {
    canonical: 'Cumbres',
    token: 'cumbres',
    typos: ['cumpres', 'cunbres', 'cumbress'],
  },
  {
    canonical: 'San Pedro',
    phrases: ['san pedro', 'san pedro garza garca', 'san pedro garza garcia', 'san pedro garza garcía'],
  },
  {
    canonical: 'Carretera Nacional',
    phrases: ['carretera nacional', 'carretera nacionl', 'carretera nacinal', 'carretera naciona'],
  },
  {
    canonical: 'García',
    phrases: ['garcia', 'garcía', 'garca'],
  },
];

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * @param {string} raw
 * @returns {string|null}
 */
function fuzzyResolveZone(raw) {
  const lower = normalizeText(String(raw || ''));
  if (!lower) return null;

  for (const entry of FLEX_ZONE_CATALOG) {
    for (const phrase of entry.phrases || []) {
      if (lower.includes(phrase)) return entry.canonical;
    }
  }

  if (/\bcarretera\b/.test(lower)) {
    const tail = lower.replace(/^.*\bcarretera\s+/, '').trim();
    if (!tail || levenshtein(tail.replace(/\s+/g, ''), 'nacional') <= 2) {
      return 'Carretera Nacional';
    }
  }

  const words = lower.split(/\s+/).filter(Boolean);
  for (const word of words) {
    for (const entry of FLEX_ZONE_CATALOG) {
      if (!entry.token && !entry.typos) continue;
      const targets = [entry.token, ...(entry.typos || [])].filter(Boolean);
      for (const target of targets) {
        if (word === target || levenshtein(word, target) <= 1) {
          return entry.canonical;
        }
      }
    }
  }

  if (/\bsan\s+pedro\b/.test(lower) && /\bgarza\b/.test(lower)) {
    return 'San Pedro';
  }

  return null;
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
function isFuzzyKnownZoneToken(raw) {
  return !!fuzzyResolveZone(raw);
}

module.exports = {
  fuzzyResolveZone,
  isFuzzyKnownZoneToken,
  levenshtein,
};
