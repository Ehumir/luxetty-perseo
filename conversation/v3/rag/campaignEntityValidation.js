'use strict';

/**
 * RC12 — Validación entidad campaña (texto + chunks recuperados).
 */

const { isRagRc12CampaignEntityValidationEnabled } = require('../../../config/accP0Flags');
const { validateCampaignEntityClaim } = require('./ragPolicy');
const { chunkScore } = require('./ragRetrievalMetrics');

/**
 * Bloquea claims de campaña inexistente / seed genérico sin property_id.
 * @returns {{ valid: boolean, reason: string|null, top: object|null }}
 */
function validateCampaignEntityMatch(text, chunks = [], { propertyRow = null } = {}) {
  if (!isRagRc12CampaignEntityValidationEnabled()) {
    return { valid: true, reason: 'flag_off', top: null };
  }

  const t = String(text || '');
  const looksCampaign = /\bcampa[nñ]a\b|\bpauta\b|\bmeta\b/i.test(t);
  if (!looksCampaign) {
    return { valid: true, reason: null, top: null };
  }

  const list = Array.isArray(chunks) ? [...chunks] : [];
  list.sort((a, b) => chunkScore(b) - chunkScore(a));
  const top = list[0] || null;

  // Nombre inventado explícito en query → inválido si no hay chunk campaigns fuerte.
  if (/inexistent|inventad|xyz-?\d+/i.test(t)) {
    const topOk =
      top &&
      (top.registry_domain_code === 'campaigns' || top.source_type === 'campaign') &&
      chunkScore(top) >= 0.72 &&
      validateCampaignEntityClaim({ chunk: top, propertyRow }).ok;
    if (!topOk) {
      return { valid: false, reason: 'inexistent_campaign', top };
    }
  }

  if (!top) {
    return { valid: false, reason: 'no_campaign_chunk', top: null };
  }

  const gate = validateCampaignEntityClaim({ chunk: top, propertyRow });
  if (!gate.ok) {
    // Seeds genéricos (camp-01 sin property_id) no pueden afirmar entidad concreta.
    return { valid: false, reason: gate.reason, top };
  }
  return { valid: true, reason: null, top };
}

module.exports = {
  validateCampaignEntityMatch,
};
