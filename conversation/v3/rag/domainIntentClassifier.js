'use strict';

/**
 * RQ-3 — Clasificador de dominio para retrieval (regex + hints; sin LLM).
 */

const DOMAIN_PATTERNS = [
  { domain: 'commercial_objections', re: /\bcomisi[oó]n\b|\bexclusiv|\bvaluaci[oó]n\b|\bcu[aá]nto\s+cobran\b|\bcu[aá]nto\s+vale\b|\bobjeci[oó]n\b|\bvender\s+mi\s+casa\b|\btiempos?\s+de\s+venta\b/i },
  { domain: 'assignment_rules', re: /\basignaci[oó]n\b|\bownership\b|\bdue[nñ]o\b|\bdios\s+mode\b|\bqui[eé]n\s+es\s+el\s+due/i },
  { domain: 'rules_atena', re: /\bsolicitud\b|\blead\b|\batena\b|\bcontacto\b.*\bcrea/i },
  { domain: 'rules_perseo', re: /\bpol[ií]tica\b|\bregla\b|\bno\s+invent|\bperseo\b/i },
  { domain: 'campaigns', re: /\bcampa[nñ]a\b|\bpauta\b|\bmeta\b/i },
  { domain: 'zones', re: /\bcolonia\b|\bzona\b|\bubicaci[oó]n\b|\ben\s+qu[eé]\s+colonia\b/i },
  { domain: 'scripts', re: /\bscript\b|\bsaludo\b|\bcierre\s+suave\b/i },
  { domain: 'properties', re: /\blux[- ]?[a-z]?\d+\b|\bpropiedad\b|\bcasa\b|\bdepa|\bjard[ií]n\b|\brenta\b|\bventa\b|\bcomprar\b|\bprecio\b|\bbusco\b/i },
];

/**
 * @param {string} text
 * @returns {{ domain: string, confidence: number, matched: boolean }}
 */
function classifyDomainIntent(text) {
  const t = String(text || '');
  if (!t.trim()) {
    return { domain: 'scripts', confidence: 0, matched: false };
  }
  for (const { domain, re } of DOMAIN_PATTERNS) {
    if (re.test(t)) {
      return { domain, confidence: 0.85, matched: true };
    }
  }
  return { domain: 'scripts', confidence: 0.3, matched: false };
}

module.exports = {
  classifyDomainIntent,
  DOMAIN_PATTERNS,
};
