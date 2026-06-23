'use strict';

/**
 * AG-C — Clasificación central de fuente inbound PERSEO (WhatsApp).
 * No inventa campaña sin evidencia. Orgánico directo es válido.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const { extractPropertyCode } = require('./propertyIntentResolver');
const { extractCampaignReferralContext } = require('../services/leadAutomation');
const { extractBridgeToken } = require('../services/intake/extractBridgeToken');
const { extractWhatsAppReferral } = require('../utils/helpers');
const {
  matchesSellerAcquisitionPattern,
  isAmbiguousOwnerPropertyOrientation,
} = require('./v3/interpreter/campaignIntake');

/** @typedef {'meta_campaign'|'landing_whatsapp'|'property_whatsapp'|'organic_direct'|'intake_bridge'|'portal_broker'|'unknown'} PerseoInboundSourceType */

/**
 * @param {object} input
 * @returns {{
 *   sourceType: PerseoInboundSourceType,
 *   confidence: 'high'|'medium'|'low',
 *   campaignMetadata: Record<string, unknown>|null,
 *   propertyContext: Record<string, unknown>|null,
 *   landingContext: Record<string, unknown>|null,
 *   organicReason: string|null,
 *   missingEvidence: string[],
 * }}
 */
function classifyPerseoInboundSource(input = {}) {
  const {
    messageText = '',
    aiState = {},
    referral = null,
    rawPayload = null,
    campaignContext: campaignContextInput = null,
  } = input;

  const text = normalizeText(messageText || '');
  const missingEvidence = [];

  const message =
    rawPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
    rawPayload?.messages?.[0] ||
    null;

  const normalizedReferral =
    (referral && typeof referral === 'object' ? referral : null) ||
    (aiState?.whatsapp_referral && typeof aiState.whatsapp_referral === 'object' ? aiState.whatsapp_referral : null) ||
    (message ? extractWhatsAppReferral(message) : null);

  const { campaignContext: extractedCampaign } = extractCampaignReferralContext({
    aiState,
    referral: normalizedReferral,
    rawPayload,
    messageText: text,
  });

  const campaignContext = campaignContextInput || extractedCampaign || null;
  const bridgeToken = extractBridgeToken({ text, referral: normalizedReferral, rawPayload });

  const propertyCode =
    cleanSpaces(
      String(
        aiState?.property_code ||
          aiState?.direct_property_code ||
          campaignContext?.property_code ||
          extractPropertyCode(text) ||
          ''
      )
    ) || null;

  const entryType = cleanSpaces(String(aiState?.entry_point_last?.entry_type || aiState?.entry_type || ''));

  if (isBrokerMessage(text, aiState)) {
    return buildResult({
      sourceType: 'portal_broker',
      confidence: 'high',
      campaignMetadata: shallowCampaign(campaignContext),
      propertyContext: propertyCode ? { property_code: propertyCode } : null,
      landingContext: null,
      organicReason: null,
      missingEvidence,
    });
  }

  if (bridgeToken || aiState?.apa_intake_hydrated || aiState?.intake_source || entryType === 'intake_bridge') {
    return buildResult({
      sourceType: 'intake_bridge',
      confidence: bridgeToken || aiState?.apa_intake_hydrated ? 'high' : 'medium',
      campaignMetadata: shallowCampaign(campaignContext),
      propertyContext: propertyCode ? { property_code: propertyCode } : null,
      landingContext: landingContextFromState(aiState, campaignContext),
      organicReason: null,
      missingEvidence,
    });
  }

  const metaEvidence = hasMetaCampaignEvidence(normalizedReferral, campaignContext, entryType);
  if (metaEvidence.high) {
    return buildResult({
      sourceType: 'meta_campaign',
      confidence: 'high',
      campaignMetadata: shallowCampaign(campaignContext),
      propertyContext: propertyCode ? { property_code: propertyCode } : null,
      landingContext: null,
      organicReason: null,
      missingEvidence,
    });
  }

  if (matchesLandingPrefab(text)) {
    return buildResult({
      sourceType: 'landing_whatsapp',
      confidence: 'high',
      campaignMetadata: shallowCampaign(campaignContext),
      propertyContext: propertyCode ? { property_code: propertyCode } : null,
      landingContext: inferLandingContext(text, campaignContext),
      organicReason: null,
      missingEvidence,
    });
  }

  if (matchesPropertyPrefab(text, propertyCode, aiState)) {
    return buildResult({
      sourceType: 'property_whatsapp',
      confidence: propertyCode ? 'high' : 'medium',
      campaignMetadata: shallowCampaign(campaignContext),
      propertyContext: { property_code: propertyCode, from_site: true },
      landingContext: null,
      organicReason: null,
      missingEvidence: propertyCode ? missingEvidence : [...missingEvidence, 'property_code'],
    });
  }

  if (metaEvidence.medium) {
    return buildResult({
      sourceType: 'meta_campaign',
      confidence: 'medium',
      campaignMetadata: shallowCampaign(campaignContext),
      propertyContext: propertyCode ? { property_code: propertyCode } : null,
      landingContext: null,
      organicReason: null,
      missingEvidence: [...missingEvidence, 'weak_meta_referral'],
    });
  }

  if (isAmbiguousAdReference(text) && !metaEvidence.low) {
    missingEvidence.push('ad_reference_without_metadata');
    return buildResult({
      sourceType: 'unknown',
      confidence: 'low',
      campaignMetadata: shallowCampaign(campaignContext),
      propertyContext: propertyCode ? { property_code: propertyCode } : null,
      landingContext: null,
      organicReason: null,
      missingEvidence,
    });
  }

  if (!normalizedReferral && !campaignContextHasData(campaignContext) && isOrganicDirectMessage(text)) {
    return buildResult({
      sourceType: 'organic_direct',
      confidence: genericOrganicConfidence(text),
      campaignMetadata: null,
      propertyContext: propertyCode ? { property_code: propertyCode } : null,
      landingContext: null,
      organicReason: organicReasonFor(text),
      missingEvidence,
    });
  }

  if (!normalizedReferral && !campaignContextHasData(campaignContext)) {
    return buildResult({
      sourceType: 'organic_direct',
      confidence: 'medium',
      campaignMetadata: null,
      propertyContext: propertyCode ? { property_code: propertyCode } : null,
      landingContext: null,
      organicReason: 'Mensaje directo sin referral Meta ni bridge de landing.',
      missingEvidence,
    });
  }

  missingEvidence.push('unclassified_inbound');
  return buildResult({
    sourceType: 'unknown',
    confidence: 'low',
    campaignMetadata: shallowCampaign(campaignContext),
    propertyContext: propertyCode ? { property_code: propertyCode } : null,
    landingContext: null,
    organicReason: null,
    missingEvidence,
  });
}

function buildResult(fields) {
  return {
    sourceType: fields.sourceType,
    confidence: fields.confidence,
    campaignMetadata: fields.campaignMetadata,
    propertyContext: fields.propertyContext,
    landingContext: fields.landingContext,
    organicReason: fields.organicReason,
    missingEvidence: fields.missingEvidence || [],
  };
}

function shallowCampaign(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const copy = { ...ctx };
  const keys = Object.keys(copy).filter((k) => copy[k] != null && String(copy[k]).trim() !== '');
  if (!keys.length) return null;
  return copy;
}

function campaignContextHasData(ctx) {
  return !!shallowCampaign(ctx);
}

function hasMetaCampaignEvidence(referral, campaignContext, entryType) {
  const ctx = campaignContext || {};
  const hasReferral =
    referral &&
    Object.keys(referral).some((k) => referral[k] != null && String(referral[k]).trim() !== '');
  const strongIds = !!(ctx.ad_id || ctx.campaign_id || ctx.ctwa_clid);
  const metaForm = entryType === 'meta_lead_form_c1';
  const pautaType = !!(ctx.campaign_type && ctx.campaign_type !== 'unknown');

  return {
    high: strongIds || metaForm || (hasReferral && (ctx.headline || ctx.ad_name)),
    medium: hasReferral || pautaType || !!(ctx.source_url && /facebook|instagram|fb\.com/i.test(String(ctx.source_url))),
    low: hasReferral,
  };
}

function matchesLandingPrefab(text) {
  if (!text) return false;
  const cumbres =
    text.includes('luxetty') &&
    (text.includes('prevaluacion') ||
      text.includes('prevaluación') ||
      text.includes('valoracion inicial') ||
      text.includes('valoración inicial') ||
      text.includes('cumbres') ||
      text.includes('zona poniente'));
  const medical =
    text.includes('consultorios') ||
    (text.includes('medico') && text.includes('monterrey')) ||
    (text.includes('médico') && text.includes('monterrey'));
  const valuation =
    text.includes('solicite valuacion') ||
    text.includes('solicité valuación') ||
    text.includes('valoracion de propiedad') ||
    text.includes('valoración de propiedad') ||
    (text.includes('cuanto vale') && text.includes('casa')) ||
    (text.includes('cuánto vale') && text.includes('casa'));
  const capture =
    matchesSellerAcquisitionPattern(text) ||
    isAmbiguousOwnerPropertyOrientation(text) ||
    (text.includes('vender mi casa') && text.includes('cumbres')) ||
    (text.includes('malbaratar') && text.includes('propiedad'));
  return cumbres || medical || valuation || capture;
}

function matchesPropertyPrefab(text, propertyCode, aiState) {
  if (propertyCode) return true;
  if (aiState?.property_specific_intent || aiState?.direct_property_reference) return true;
  const t = text || '';
  if (!t) return false;
  if (extractPropertyCode(t)) return true;
  const propertySignals =
    /\bquiero\s+verla\b/.test(t) ||
    /\bagendar\s+(?:una\s+)?visita\b/.test(t) ||
    (t.includes('propiedad') &&
      (t.includes('me interesa') ||
        t.includes('informacion') ||
        t.includes('información') ||
        t.includes('precio') ||
        t.includes('ubicacion') ||
        t.includes('ubicación') ||
        t.includes('disponible') ||
        t.includes('verla') ||
        t.includes('agendar') ||
        t.includes('visita'))) ||
    (t.includes('lux-') && t.length < 120) ||
    t.includes('vi esta casa') ||
    t.includes('vi esta propiedad') ||
    t.includes('luxetty.com') ||
    t.includes('agendar una visita');
  return propertySignals;
}

function isBrokerMessage(text, aiState) {
  if (aiState?.is_real_estate_advisor === true) return true;
  const t = text || '';
  return (
    t.includes('soy asesor inmobiliario') ||
    t.includes('soy broker') ||
    t.includes('comparten comision') ||
    t.includes('comparten comisión') ||
    t.includes('tengo cliente para') ||
    (t.includes('soy asesor') && t.includes('propiedad'))
  );
}

function isAmbiguousAdReference(text) {
  const t = text || '';
  return (
    t.includes('vi su anuncio') ||
    t.includes('vi el anuncio') ||
    t.includes('vi tu anuncio') ||
    (t.includes('anuncio') && (t.includes('vi ') || t.includes('vi su')))
  );
}

function isOrganicDirectMessage(text) {
  const t = (text || '').trim();
  if (!t) return true;
  const shortGeneric =
    t === 'hola' ||
    t === 'info' ||
    t === 'me interesa' ||
    t === 'buenos dias' ||
    t === 'buenos días' ||
    t === 'precio' ||
    t === 'ubicacion' ||
    t === 'ubicación' ||
    t.length <= 24;
  const advisor =
    t.includes('hablar con un asesor') ||
    t.includes('son inmobiliaria') ||
    t.includes('¿son inmobiliaria');
  return shortGeneric || advisor;
}

function genericOrganicConfidence(text) {
  const t = (text || '').trim();
  if (t.length <= 8) return 'high';
  if (t === 'me interesa' || t === 'info') return 'medium';
  return 'medium';
}

function organicReasonFor(text) {
  const t = (text || '').trim();
  if (t.length <= 12) return 'Saludo o mensaje corto sin referral ni contexto de landing.';
  if (t === 'me interesa' || t === 'info') return 'Mensaje genérico sin metadata de campaña — válido como orgánico.';
  return 'Contacto directo al número sin evidencia de campaña Meta ni CTA de landing.';
}

function inferLandingContext(text, campaignContext) {
  const t = text || '';
  if (t.includes('consultorio')) {
    return { landing_key: 'medical_consultorios', landing_slug: '/espacios-profesionales/consultorios-medicos-monterrey' };
  }
  if (t.includes('cumbres') || t.includes('prevaluacion') || t.includes('prevaluación')) {
    return { landing_key: 'cumbres_supply', landing_slug: '/vende-tu-propiedad-en-cumbres' };
  }
  if (campaignContext?.landing_key) {
    return { landing_key: campaignContext.landing_key, landing_slug: campaignContext.landing_slug || null };
  }
  return null;
}

function landingContextFromState(aiState, campaignContext) {
  const key = aiState?.intake_source || campaignContext?.landing_key || null;
  if (!key) return null;
  return {
    landing_key: key,
    landing_slug: campaignContext?.landing_slug || aiState?.landing_slug || null,
  };
}

/**
 * Persiste clasificación + referral/campaign en ai_state sin borrar metadata existente.
 */
function applyInboundSourceToAiState(aiState = {}, input = {}) {
  const classification = classifyPerseoInboundSource(input);
  const next = { ...aiState, inbound_source: classification };

  const message =
    input.rawPayload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ||
    input.rawPayload?.messages?.[0] ||
    null;
  const normalizedReferral =
    (input.referral && typeof input.referral === 'object' ? input.referral : null) ||
    (aiState?.whatsapp_referral && typeof aiState.whatsapp_referral === 'object' ? aiState.whatsapp_referral : null) ||
    (message ? extractWhatsAppReferral(message) : null);

  if (normalizedReferral && !hasReferralKeys(aiState?.whatsapp_referral)) {
    next.whatsapp_referral = normalizedReferral;
  }

  const { campaignContext } = extractCampaignReferralContext({
    aiState: next,
    referral: normalizedReferral,
    rawPayload: input.rawPayload,
    messageText: input.messageText || '',
  });

  if (campaignContext && Object.keys(shallowCampaign(campaignContext) || {}).length) {
    next.campaign_context = mergeCampaignContext(aiState.campaign_context, campaignContext);
  }

  return next;
}

function hasReferralKeys(referral) {
  if (!referral || typeof referral !== 'object') return false;
  return Object.keys(referral).some((k) => referral[k] != null && String(referral[k]).trim() !== '');
}

function mergeCampaignContext(existing, incoming) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  if (!incoming || typeof incoming !== 'object') return Object.keys(base).length ? base : existing || null;
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || String(value).trim() === '') continue;
    if (base[key] == null || String(base[key]).trim() === '') {
      base[key] = value;
    }
  }
  return Object.keys(base).length ? base : null;
}

module.exports = {
  classifyPerseoInboundSource,
  applyInboundSourceToAiState,
};
