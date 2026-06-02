'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');
const { CONVERSATION_GOALS, CONVERSATION_STAGES, V3_INTENT } = require('../types/constants');
const { normalizeLocationFromUserText } = require('./locationNormalizer');
const { extractLooseLocationPhrase } = require('./campaignIntake');
const { parsePropertyType } = require('./propertyTypeParser');
const { isExplicitHumanRequest } = require('./objectionClassifier');
const {
  isExplicitFlowSwitchToSellFromRent,
  isExplicitFlowSwitchToRentOut,
} = require('./campaignIntake');
const { splitNameAndTail, isLikelyFirstNameOnly } = require('./identityCompoundCapture');
const { parseMoneyAmount } = require('./moneyParser');

const LANDING_SLUG = '/vende-tu-propiedad-en-cumbres';
const CAMPAIGN_CONTEXT_KEY = 'prevaluacion_cumbres';

const LANDING_CAPTURE_FALLBACK_REPLY =
  'Para no darte una orientación incompleta, voy a canalizar tu caso con un asesor humano de Luxetty. Él podrá revisar los detalles de tu propiedad y continuar contigo por este medio.';

const REPLY_WELCOME =
  'Hola, soy el asistente IA de Luxetty. Con gusto te ayudo a iniciar tu prevaluación comercial.\n\nPara orientarte mejor, ¿me compartes por favor tu nombre y en qué colonia o zona se encuentra la propiedad?';

const REPLY_COST =
  'La prevaluación comercial inicial no tiene costo. Sirve para darte una primera orientación sobre el potencial de tu propiedad. Si después decides avanzar, un asesor de Luxetty puede explicarte el proceso y las condiciones de trabajo.';

const REPLY_NOT_APPRAISAL =
  'No. Es una prevaluación comercial inicial, no un avalúo bancario, fiscal, catastral ni pericial. Te ayuda a tener una primera referencia comercial antes de decidir vender o rentar.';

/**
 * @param {string} t normalized
 */
function matchesLandingCaptureInbound(input) {
  const text = normalizeText(String(input || ''));
  if (!text) return false;

  let score = 0;
  if (/prevaluaci[oó]n/.test(text)) score += 1;
  if (/cumbres|zona\s+poniente/.test(text)) score += 1;
  if (/propiedad/.test(text) && /(cumbres|poniente|colonia|zona)/.test(text)) score += 1;
  if (/\b(mi\s+)?casa\b/.test(text) && /cumbres/.test(text)) score += 2;
  if (/venta\s+o\s+renta|mejor\s+opci[oó]n/.test(text)) score += 1;
  if (/campa[nñ]a\s+de\s+prevaluaci[oó]n/.test(text)) score += 2;
  if (/hola\s+luxetty/.test(text)) score += 1;
  if (/quiero\s+(?:recibir\s+)?una\s+prevaluaci[oó]n/.test(text)) score += 2;
  if (/me\s+interesa\s+una\s+prevaluaci[oó]n/.test(text)) score += 2;
  if (/prevaluaci[oó]n\s+comercial\s+inicial/.test(text)) score += 2;
  if (/quiero\s+una\s+prevaluaci[oó]n/.test(text)) score += 2;

  return score >= 2;
}

function isLandingCaptureActive(state) {
  return state.landingCaptureFlow === true;
}

function buildLandingCaptureBootstrapPatch() {
  return {
    landingCaptureFlow: true,
    sourceContext: 'campaign_landing',
    campaignContextKey: CAMPAIGN_CONTEXT_KEY,
    landingSlug: LANDING_SLUG,
    captureChannel: 'whatsapp',
    conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
    conversationGoalLocked: true,
    leadFlow: 'offer',
    operationTypePending: true,
    operationType: null,
    propertySpecificIntent: false,
    campaign_context: {
      source_context: 'campaign_landing',
      campaign_context: CAMPAIGN_CONTEXT_KEY,
      landing_slug: LANDING_SLUG,
      capture_channel: 'whatsapp',
      lead_intent: 'capture_property',
      lead_type: 'supply',
      operation_type: 'pending_confirmation',
    },
    user_goal: 'capture_property',
    lead_type: 'supply',
    landingCaptureStage: 'name_zone',
    conversationStage: CONVERSATION_STAGES.QUALIFYING,
    awaitingField: 'full_name',
    lastAskedField: 'full_name',
  };
}

function parseNameAndZone(raw) {
  const t = normalizeText(String(raw || ''));
  let name = null;
  let zone = null;

  const estaEn = t.match(/\best[aá]\s+en\s+(.+?)(?:\s*[.!?]|$)/);
  if (estaEn) {
    zone = cleanSpaces(estaEn[1]);
    const norm = normalizeLocationFromUserText(estaEn[1]);
    if (norm && norm.length > zone.length) zone = norm;
  }

  const soyShort = t.match(/^soy\s+([a-záéíóúñ][a-záéíóúñ.'-]{1,24})(?:\s*[.,]|\s+est[aá]|\s+y\s+|$)/);
  if (soyShort) {
    name = cleanSpaces(soyShort[1]);
  }

  const compound = splitNameAndTail(raw);
  if (compound && !name) {
    name = compound.name;
    if (!zone) {
      zone =
        normalizeLocationFromUserText(compound.tail) ||
        extractLooseLocationPhrase(compound.tail) ||
        cleanSpaces(compound.tail);
    }
  }

  if (!zone) {
    zone = normalizeLocationFromUserText(raw) || extractLooseLocationPhrase(raw);
  }

  if (!name && isLikelyFirstNameOnly(raw) && !zone) {
    name = cleanSpaces(raw);
  }

  if (name) {
    name = name.replace(/^soy\s+/i, '').trim();
    const parts = name.split(/\s+/);
    if (parts.length > 3) name = parts.slice(0, 2).join(' ');
  }
  if (name && name.length > 48) name = name.slice(0, 48);
  if (zone && zone.length > 80) zone = zone.slice(0, 80);

  return { name, zone };
}

function parseOperationIntent(raw) {
  const t = normalizeText(String(raw || ''));
  if (
    /\b(explorando|no\s+se|no\s+sé|aun\s+no|aún\s+no|todavia\s+no|todavía\s+no|depende|conocer\s+opciones|estoy\s+explorando)\b/.test(
      t,
    )
  ) {
    return 'exploring';
  }
  if (
    isExplicitFlowSwitchToSellFromRent(raw) ||
    /\b(quiero\s+vender|venderla|ponerla\s+en\s+venta|poner\s+en\s+venta|en\s+realidad\s+quiero\s+vender)\b/.test(
      t,
    )
  ) {
    return 'sale';
  }
  if (
    isExplicitFlowSwitchToRentOut(raw) ||
    (/\b(quiero\s+rentar|rentarla|ponerla\s+en\s+renta|arrendar)\b/.test(t) &&
      /\b(mi|propiedad|casa|depa|departamento)\b/.test(t))
  ) {
    return 'rent';
  }
  return null;
}

function isValuationCostQuestion(t) {
  return /\b(cu[aá]nto\s+cuesta|tiene\s+costo|es\s+gratis|costo\s+de\s+la\s+prevaluaci[oó]n)\b/.test(t);
}

function isAppraisalQuestion(t) {
  return /\b(aval[uú]o|avaluo|aval[uú]o\s+bancario|aval[uú]o\s+fiscal|aval[uú]o\s+catastral|aval[uú]o\s+pericial)\b/.test(
    t,
  );
}

function firstNameFromState(state) {
  const full = cleanSpaces(String(state.collectedFields?.fullName || ''));
  if (!full) return null;
  return full.split(/\s+/)[0];
}

function propertyTypeLabel(type) {
  const map = {
    house: 'casa',
    apartment: 'departamento',
    land: 'terreno',
    commercial: 'local',
  };
  return map[type] || 'inmueble';
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} raw
 */
function advanceLandingCaptureStage(state, raw) {
  const t = normalizeText(raw);
  const stage = state.landingCaptureStage || 'name_zone';
  const nm = firstNameFromState(state);

  if (isValuationCostQuestion(t)) {
    return { reply: REPLY_COST, patch: {}, handoff: false, intent: V3_INTENT.LANDING_CAPTURE };
  }
  if (isAppraisalQuestion(t)) {
    return { reply: REPLY_NOT_APPRAISAL, patch: {}, handoff: false, intent: V3_INTENT.LANDING_CAPTURE };
  }

  if (stage === 'name_zone') {
    const { name, zone } = parseNameAndZone(raw);
    if (!name && !zone) {
      return { reply: null, patch: {}, handoff: true, intent: V3_INTENT.UNKNOWN };
    }
    const patch = {
      landingCaptureStage: 'property_type',
      awaitingField: 'property_type',
      lastAskedField: 'property_type',
    };
    if (name) {
      patch.collectedFields = { ...(state.collectedFields || {}), fullName: name };
      patch.identityState = 'PARTIAL';
    }
    if (zone) {
      patch.locationText = zone;
      patch.zone = zone;
    }
    const first = name ? name.split(/\s+/)[0].replace(/[.,!?]+$/, '') : null;
    const greet = first ? `Gracias, ${first}.` : 'Gracias.';
    const zonePart = zone ? ` Tomo nota de que la propiedad está en ${zone}.` : '';
    const reply = `${greet}${zonePart}\n\n¿La propiedad es casa, departamento, terreno o local?`;
    return { reply, patch, handoff: false, intent: V3_INTENT.LANDING_CAPTURE };
  }

  if (stage === 'property_type') {
    const prop = parsePropertyType(raw);
    if (!prop) {
      return { reply: null, patch: {}, handoff: true, intent: V3_INTENT.UNKNOWN };
    }
    const patch = {
      propertyType: prop,
      collectedFields: { ...(state.collectedFields || {}), propertyType: prop },
      landingCaptureStage: 'operation',
      awaitingField: 'operation_type',
      lastAskedField: 'operation_type',
    };
    return {
      reply: 'Perfecto. ¿Estás pensando venderla, rentarla o todavía estás explorando opciones?',
      patch,
      handoff: false,
      intent: V3_INTENT.LANDING_CAPTURE,
    };
  }

  if (stage === 'operation') {
    const op = parseOperationIntent(raw);
    if (!op) {
      return { reply: null, patch: {}, handoff: true, intent: V3_INTENT.UNKNOWN };
    }
    const patch = {
      landingCaptureStage: 'price',
      awaitingField: 'expected_price',
      lastAskedField: 'expected_price',
      is_exploring_sale: op === 'exploring',
    };
    if (op === 'sale') {
      patch.operationType = 'sale';
      patch.operationTypePending = false;
      patch.leadFlow = 'offer';
      return {
        reply:
          'Excelente. Para darte una primera orientación comercial, ¿tienes algún precio aproximado en mente o prefieres que lo revisemos contigo?',
        patch,
        handoff: false,
        intent: V3_INTENT.LANDING_CAPTURE,
      };
    }
    if (op === 'rent') {
      patch.operationType = 'rent';
      patch.operationTypePending = false;
      patch.leadFlow = 'offer';
      return {
        reply:
          'Perfecto. Para orientarte mejor sobre la renta, ¿tienes algún rango mensual esperado o prefieres que lo revisemos contigo?',
        patch,
        handoff: false,
        intent: V3_INTENT.LANDING_CAPTURE,
      };
    }
    patch.operationTypePending = true;
    patch.operationType = null;
    return {
      reply:
        'Claro, es válido explorarlo antes de decidir. Podemos ayudarte a entender el potencial comercial de tu propiedad.\n\n¿Tienes algún rango de precio o renta en mente, o prefieres que primero revisemos la información básica contigo?',
      patch,
      handoff: false,
      intent: V3_INTENT.LANDING_CAPTURE,
    };
  }

  if (stage === 'price') {
    const amount = parseMoneyAmount(raw);
    const patch = {
      landingCaptureStage: 'done',
      awaitingField: null,
      qualificationComplete: false,
    };
    if (amount != null) {
      patch.expectedPrice = amount;
      patch.collectedFields = { ...(state.collectedFields || {}), expectedPrice: amount };
    }
    const greet = nm ? `${nm}, ` : '';
    return {
      reply: `${greet}con lo que me compartiste ya tengo una base para orientarte. Un asesor de Luxetty puede continuar contigo por este medio para afinar tu prevaluación comercial.`,
      patch,
      handoff: false,
      intent: V3_INTENT.LANDING_CAPTURE,
    };
  }

  return { reply: null, patch: {}, handoff: true, intent: V3_INTENT.UNKNOWN };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} raw
 * @param {string} t
 * @param {Partial<import('../types/conversationState').ConversationState>} patch
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 */
function tryInterpretLandingCapture(state, raw, t, patch, decision) {
  if (isExplicitHumanRequest(raw) || /\b(prefiero\s+hablar|quiero\s+una\s+persona|asesor\s+humano)\b/.test(t)) {
    if (isLandingCaptureActive(state) || matchesLandingCaptureInbound(t)) {
      decision.detectedIntent = V3_INTENT.LANDING_CAPTURE;
      decision.confidence = 0.95;
      decision.landingCaptureHandoff = true;
      decision.landingCaptureReply = LANDING_CAPTURE_FALLBACK_REPLY;
      patch.landingCaptureFlow = true;
      return { patch, decision };
    }
  }

  if (isLandingCaptureActive(state)) {
    const advanced = advanceLandingCaptureStage(state, raw);
    decision.detectedIntent = advanced.intent;
    decision.confidence = advanced.handoff ? 0.4 : 0.92;
    decision.explicitFlowSwitch = false;
    if (advanced.handoff) {
      decision.landingCaptureHandoff = true;
      decision.landingCaptureReply = LANDING_CAPTURE_FALLBACK_REPLY;
      return { patch, decision };
    }
    Object.assign(patch, advanced.patch);
    decision.landingCaptureReply = advanced.reply;
    return { patch, decision };
  }

  if (matchesLandingCaptureInbound(t)) {
    Object.assign(patch, buildLandingCaptureBootstrapPatch());
    decision.detectedIntent = V3_INTENT.LANDING_CAPTURE;
    decision.confidence = 0.94;
    decision.explicitFlowSwitch = true;
    decision.landingCaptureReply = REPLY_WELCOME;
    return { patch, decision };
  }

  return null;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 */
function composeLandingCaptureReply(state, decision) {
  if (decision.landingCaptureReply) return String(decision.landingCaptureReply);
  if (decision.landingCaptureHandoff) return LANDING_CAPTURE_FALLBACK_REPLY;
  if (isLandingCaptureActive(state)) return REPLY_WELCOME;
  return null;
}

module.exports = {
  LANDING_SLUG,
  CAMPAIGN_CONTEXT_KEY,
  LANDING_CAPTURE_FALLBACK_REPLY,
  matchesLandingCaptureInbound,
  isLandingCaptureActive,
  tryInterpretLandingCapture,
  composeLandingCaptureReply,
  buildLandingCaptureBootstrapPatch,
};
