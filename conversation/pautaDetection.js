'use strict';

const propertyIntentResolver = require('./propertyIntentResolver');
const { cleanSpaces } = require('../utils/text');

function hasReferralContext(referral) {
  if (!referral || typeof referral !== 'object') return false;
  return Object.keys(referral).some((k) => {
    const v = referral[k];
    return v != null && String(v).trim() !== '';
  });
}

function campaignPropertyCode(aiState = {}) {
  const ctx = aiState?.campaign_context;
  if (!ctx || typeof ctx !== 'object') return null;
  const raw = cleanSpaces(String(ctx.property_code || ctx.listing_code || ctx.property_id || ''));
  if (!raw) return null;
  return propertyIntentResolver.normalizePropertyCode(raw) || raw;
}

function statePropertyCode(aiState = {}) {
  const raw = cleanSpaces(
    String(
      aiState?.property_code ||
        aiState?.direct_property_code ||
        aiState?.current_property_code ||
        ''
    )
  );
  if (!raw) return null;
  return propertyIntentResolver.normalizePropertyCode(raw) || raw;
}

/**
 * Conversación de pauta o campaña WA (para followups / cierre).
 */
function isPautaConversation(aiState = {}) {
  if (!aiState || typeof aiState !== 'object') return false;
  if (hasReferralContext(aiState.whatsapp_referral)) return true;
  if (campaignPropertyCode(aiState)) return true;
  if (aiState.campaign_context && typeof aiState.campaign_context === 'object') {
    const keys = Object.keys(aiState.campaign_context).filter(
      (k) => aiState.campaign_context[k] != null && String(aiState.campaign_context[k]).trim() !== ''
    );
    if (keys.length > 0) return true;
  }
  return false;
}

/**
 * Contexto comercial ligado a propiedad con código válido (Cuarzo CRM bypass controlado).
 * @param {object} aiState
 * @param {{ propertyId?: string|null }} [opts]
 */
function resolvePautaPropertyCrmContext(aiState = {}, opts = {}) {
  const propertyId =
    opts.propertyId != null
      ? opts.propertyId
      : aiState?.interested_property_id || aiState?.current_interested_property_id || null;

  const propertyCode = statePropertyCode(aiState) || campaignPropertyCode(aiState);
  const propertySpecific = propertyIntentResolver.isPropertySpecificConversation(aiState);
  const hasCampaign = isPautaConversation(aiState);
  const hasResolvableProperty = !!(propertyCode || propertyId);

  const commercialPropertyContext =
    (propertySpecific && !!propertyCode) ||
    (!!propertyCode && hasCampaign) ||
    (!!propertyId && (propertySpecific || hasCampaign));

  const bypassEligible =
    commercialPropertyContext && hasResolvableProperty && (propertySpecific || hasCampaign);

  let reason = null;
  if (!bypassEligible) {
    if (!hasResolvableProperty) reason = 'missing_property_code_or_id';
    else if (!propertySpecific && !hasCampaign) reason = 'not_pauta_or_property_mode';
    else reason = 'insufficient_commercial_property_context';
  }

  return {
    bypassEligible,
    propertyCode,
    propertyId: propertyId || null,
    propertySpecific,
    hasCampaign,
    hasReferral: hasReferralContext(aiState?.whatsapp_referral),
    reason,
  };
}

function isPautaPropertyBypassEnabled() {
  return process.env.PERSEO_CRM_EXECUTE_PAUTA_PROPERTY_BYPASS !== 'false';
}

/**
 * Elegibilidad V3 primary por entrada de propiedad/pauta (MC-6 #46) — sin expandir allowlist.
 * @param {{ aiState?: object, text?: string, propertyId?: string|null }} input
 */
function resolvePropertyEntryV3Eligibility(input = {}) {
  const aiState = input.aiState && typeof input.aiState === 'object' ? input.aiState : {};
  const text = String(input.text || '');
  const propertyId = input.propertyId != null ? input.propertyId : null;

  const pautaCtx = resolvePautaPropertyCrmContext(aiState, { propertyId });
  if (pautaCtx.bypassEligible) {
    return {
      eligible: true,
      reason: 'pauta_property',
      propertyCode: pautaCtx.propertyCode || null,
    };
  }

  try {
    const { isPropertyAdEntry } = require('./leadEntryPointRouter');
    if (isPropertyAdEntry(text)) {
      return {
        eligible: true,
        reason: 'property_ad_entry_text',
        propertyCode: statePropertyCode(aiState) || null,
      };
    }
  } catch (_e) {
    /* optional in tests */
  }

  if (
    propertyId &&
    propertyIntentResolver.isPropertySpecificConversation(aiState)
  ) {
    return {
      eligible: true,
      reason: 'resolved_property_context',
      propertyCode: statePropertyCode(aiState) || null,
    };
  }

  return { eligible: false, reason: pautaCtx.reason || 'not_property_entry', propertyCode: null };
}

function isPropertyEntryAutoPrimaryEnabled() {
  return process.env.PERSEO_V3_PROPERTY_ENTRY_AUTO_PRIMARY === 'true';
}

module.exports = {
  isPautaConversation,
  resolvePautaPropertyCrmContext,
  resolvePropertyEntryV3Eligibility,
  isPautaPropertyBypassEnabled,
  isPropertyEntryAutoPrimaryEnabled,
  campaignPropertyCode,
  statePropertyCode,
};
