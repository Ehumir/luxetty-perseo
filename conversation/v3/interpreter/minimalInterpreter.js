'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');
const { createEmptyDecision } = require('../types/conversationDecision');
const { CONVERSATION_STAGES, V3_INTENT, CONVERSATION_GOALS } = require('../types/constants');
const { detectFrustration } = require('./frustrationDetector');
const { normalizeLocationFromUserText } = require('./locationNormalizer');
const { shouldAcceptAsIdentityName } = require('./nameHeuristics');
const { parsePropertyType } = require('./propertyTypeParser');
const { parseOccupancyStatus } = require('./occupancyParser');
const { tryParseSellLocation } = require('./sellLocationCapture');

function parseMoneyAmount(text) {
  const t = normalizeText(text);
  const mill = t.match(/(\d+(?:[.,]\d+)?)\s*(millones|millon|millón|mdp)/);
  if (mill) {
    const n = Number(mill[1].replace(',', '.'));
    return Math.round(n * 1_000_000);
  }
  const mdp = t.match(/\b(\d+(?:[.,]\d+)?)\s*mdp\b/);
  if (mdp) return Math.round(Number(mdp[1].replace(',', '.')) * 1_000_000);
  return null;
}

function parseBedrooms(text) {
  const t = normalizeText(text);
  const m = t.match(/(\d+)\s*(recamaras?|recámaras?|habitaciones?|cuartos?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 20 ? n : null;
}

function isExplicitFlowSwitchToBuy(text) {
  const t = normalizeText(text);
  return (
    t.includes('ahora busco comprar') ||
    t.includes('en realidad busco') ||
    t.includes('no quiero vender') ||
    (/\bbusco\b/.test(t) && (t.includes('comprar') || t.includes('casa'))) ||
    t.includes('quiero comprar')
  );
}

function isExplicitFlowSwitchToSell(text) {
  const t = normalizeText(text);
  return t.includes('quiero vender') || t.includes('vender mi') || t.includes('poner en venta');
}

function isShortAck(text) {
  const t = normalizeText(text);
  return (
    t === 'si' ||
    t === 'sí' ||
    t === 'ok' ||
    t === 'vale' ||
    t === 'claro' ||
    t === 'nada' ||
    t === 'no' ||
    t === 'ya' ||
    t === 'bueno'
  );
}

function applyPropertyTypePatch(patch, type) {
  if (!type) return;
  patch.propertyType = type;
  patch.collectedFields = { ...(patch.collectedFields || {}), propertyType: type };
}

function applyOccupancyPatch(patch, status) {
  if (!status) return;
  patch.occupancyStatus = status;
  patch.collectedFields = { ...(patch.collectedFields || {}), occupancyStatus: status };
  patch.awaitingField = null;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} text
 */
function interpretUserMessage(state, text) {
  const t = normalizeText(String(text || ''));
  const raw = cleanSpaces(String(text || ''));
  const decision = createEmptyDecision();
  /** @type {Partial<import('../types/conversationState').ConversationState>} */
  const patch = { lastUserText: raw };

  const sellCtx =
    state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY || state.leadFlow === 'offer';
  const sellLocation = tryParseSellLocation(state, raw);
  if (sellLocation) {
    decision.detectedIntent = V3_INTENT.LOCATION_CAPTURE;
    decision.confidence = 0.9;
    patch.locationText = sellLocation;
    patch.awaitingField = null;
    decision.extractedEntities.locationText = sellLocation;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  const fr = detectFrustration(text);
  if (fr.isFrustrated) {
    const sellCtxFr =
      state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY || state.leadFlow === 'offer';
    const propOnFrustration = parsePropertyType(text);
    if (sellCtxFr && propOnFrustration) {
      applyPropertyTypePatch(patch, propOnFrustration);
    }
    decision.detectedIntent = V3_INTENT.FRUSTRATION;
    decision.confidence = 0.9;
    decision.shouldEscalateHuman = false;
    patch.frustrationState = fr.level;
    return { patch, decision };
  }

  const occupancyParsed = parseOccupancyStatus(text);
  if (occupancyParsed && sellCtx) {
    decision.detectedIntent = V3_INTENT.OCCUPANCY_CAPTURE;
    decision.confidence = 0.92;
    applyOccupancyPatch(patch, occupancyParsed);
    decision.explicitFlowSwitch = false;
    decision.nextSuggestedStage = CONVERSATION_STAGES.READY_FOR_CRM;
    return { patch, decision };
  }

  if (isShortAck(t) && state.conversationGoalLocked) {
    decision.detectedIntent = V3_INTENT.UNKNOWN;
    decision.confidence = 0.5;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  if (t === 'hola' || t.startsWith('hola ') || t === 'buenas' || t === 'hey') {
    decision.detectedIntent = V3_INTENT.GREETING;
    decision.confidence = 0.7;
    decision.nextSuggestedStage = CONVERSATION_STAGES.UNDERSTANDING;
    return { patch, decision };
  }

  if (isExplicitFlowSwitchToBuy(text) && (!state.conversationGoalLocked || isExplicitFlowSwitchToBuy(text))) {
    decision.detectedIntent = V3_INTENT.BUY_PROPERTY;
    decision.confidence = 0.85;
    decision.explicitFlowSwitch = !state.conversationGoalLocked || isExplicitFlowSwitchToBuy(text);
    patch.conversationGoal = CONVERSATION_GOALS.BUY_PROPERTY;
    patch.leadFlow = 'demand';
    patch.operationType = 'sale';
    if (t.includes('cumbres')) {
      patch.locationText = 'Cumbres';
      decision.extractedEntities.locationText = 'Cumbres';
    }
    decision.shouldAskName = !state.collectedFields?.fullName;
    return { patch, decision };
  }

  const wantsRent = t.includes('rentar') || t.includes('arrendar') || (t.includes('renta') && t.includes('busco'));
  if (wantsRent && (!state.conversationGoalLocked || decision.explicitFlowSwitch)) {
    decision.detectedIntent = V3_INTENT.RENT_PROPERTY;
    decision.confidence = 0.8;
    decision.explicitFlowSwitch = !state.conversationGoalLocked;
    patch.conversationGoal = CONVERSATION_GOALS.RENT_PROPERTY;
    patch.leadFlow = 'demand';
    patch.operationType = 'rent';
    decision.shouldAskName = !state.collectedFields?.fullName;
    return { patch, decision };
  }

  if (isExplicitFlowSwitchToSell(text) || (t.includes('vender') && t.includes('casa'))) {
    decision.detectedIntent = V3_INTENT.SELL_PROPERTY;
    decision.confidence = 0.9;
    decision.explicitFlowSwitch = !state.conversationGoalLocked || isExplicitFlowSwitchToSell(text);
    patch.conversationGoal = CONVERSATION_GOALS.SELL_PROPERTY;
    patch.leadFlow = 'offer';
    patch.operationType = 'sale';
    applyPropertyTypePatch(patch, parsePropertyType(text) || 'house');
    decision.shouldAskName = !state.collectedFields?.fullName;
    decision.nextSuggestedStage = state.collectedFields?.fullName
      ? CONVERSATION_STAGES.QUALIFYING
      : CONVERSATION_STAGES.IDENTITY_PENDING;
    return { patch, decision };
  }

  if (/\bbusco\b/.test(t) && t.includes('casa') && (!state.conversationGoalLocked || isExplicitFlowSwitchToBuy(text))) {
    decision.detectedIntent = V3_INTENT.BUY_PROPERTY;
    decision.confidence = 0.8;
    decision.explicitFlowSwitch = !state.conversationGoalLocked;
    patch.conversationGoal = CONVERSATION_GOALS.BUY_PROPERTY;
    patch.leadFlow = 'demand';
    patch.operationType = 'sale';
    if (t.includes('cumbres')) {
      patch.locationText = 'Cumbres';
      decision.extractedEntities.locationText = 'Cumbres';
    }
    decision.shouldAskName = !state.collectedFields?.fullName;
    return { patch, decision };
  }

  const sellCtxEarly =
    state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY || state.leadFlow === 'offer';
  const propTypeEarly = parsePropertyType(text);
  if (propTypeEarly && sellCtxEarly) {
    decision.detectedIntent = V3_INTENT.PROPERTY_TYPE_CAPTURE;
    decision.confidence = 0.9;
    applyPropertyTypePatch(patch, propTypeEarly);
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  const nameMatch = raw.match(/^(?:soy|me llamo|mi nombre es)\s+(.+)/i);
  const explicitName = !!nameMatch;
  if (
    shouldAcceptAsIdentityName(state, explicitName ? nameMatch[1] : raw, { explicitNameMatch: explicitName })
  ) {
    const nm = cleanSpaces(explicitName ? nameMatch[1] : raw);
    if (nm) {
      decision.detectedIntent = V3_INTENT.IDENTITY_CAPTURE;
      decision.confidence = 0.92;
      decision.extractedEntities.fullName = nm;
      patch.collectedFields = { ...(patch.collectedFields || {}), fullName: nm };
      decision.shouldAskName = false;
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
  }

  const br = parseBedrooms(text);
  if (br != null && state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
    decision.detectedIntent = V3_INTENT.BEDROOMS_CAPTURE;
    decision.confidence = 0.85;
    patch.bedrooms = br;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  const amount = parseMoneyAmount(text);
  if (amount != null) {
    const sellCtx = state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY || state.leadFlow === 'offer';
    if (sellCtx) {
      decision.detectedIntent = V3_INTENT.SELLER_PRICE;
      patch.expectedPrice = amount;
      patch.budget = null;
      decision.extractedEntities.expectedPrice = amount;
    } else {
      decision.detectedIntent = V3_INTENT.BUYER_BUDGET;
      patch.budget = amount;
      decision.extractedEntities.budget = amount;
    }
    decision.confidence = 0.88;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  decision.detectedIntent = V3_INTENT.UNKNOWN;
  decision.confidence = 0.25;
  decision.explicitFlowSwitch = false;
  return { patch, decision };
}

module.exports = {
  interpretUserMessage,
  parseMoneyAmount,
  parseBedrooms,
  normalizeLocationFromUserText,
};
