'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');
const { createEmptyDecision } = require('../types/conversationDecision');
const { CONVERSATION_STAGES, V3_INTENT, CONVERSATION_GOALS } = require('../types/constants');
const { detectFrustration } = require('./frustrationDetector');
const { normalizeLocationFromUserText } = require('./locationNormalizer');
const { shouldAcceptAsIdentityName, isAwaitingIdentityName } = require('./nameHeuristics');
const { parsePropertyType } = require('./propertyTypeParser');
const { parseOccupancyStatus } = require('./occupancyParser');
const { tryParseSellLocation, tryParseQualificationLocation } = require('./sellLocationCapture');
const { parseAdvisorContactConsent, shouldParseConsentTurn } = require('../planner/consentParser');
const { isV3HandoffEnabled } = require('../../../config/perseoV3Flags');
const { extractPropertyListingCode } = require('./propertyListingCode');
const {
  matchesSellerAcquisitionPattern,
  extractLooseLocationPhrase,
  isThinGenericInbound,
  mentionsRentDemand,
  isExplicitFlowSwitchToRentDemand,
  isExplicitFlowSwitchToRentOut,
  isExplicitFlowSwitchToSellFromRent,
  isExplicitPropertyInquiryPhrase,
} = require('./campaignIntake');
const { splitNameAndTail, parseChannelPreference, isLikelyFirstNameOnly } = require('./identityCompoundCapture');
const { classifyPropertyInquiryTurn } = require('./propertyInquiryQaClassifier');
const { parsePaymentMethod } = require('./paymentMethodParser');

function parseMoneyAmount(text) {
  const t = normalizeText(text);
  const below = t.match(
    /(?:por\s+)?(?:debajo|menos)\s+de\s+(\d+(?:[.,]\d+)?)\s*(millones|millon|millón|m\b|mdp)?/
  );
  if (below) {
    const n = Number(below[1].replace(',', '.'));
    const unit = below[2] || '';
    if (unit === 'm' || !unit || /millon/.test(unit) || unit === 'mdp') {
      return Math.round(n * 1_000_000);
    }
  }
  const mill = t.match(/(\d+(?:[.,]\d+)?)\s*(millones|millon|millón|mdp)/);
  if (mill) {
    const n = Number(mill[1].replace(',', '.'));
    return Math.round(n * 1_000_000);
  }
  const mShort = t.match(/\b(\d+(?:[.,]\d+)?)\s*m\b/);
  if (mShort) return Math.round(Number(mShort[1].replace(',', '.')) * 1_000_000);
  const mdp = t.match(/\b(\d+(?:[.,]\d+)?)\s*mdp\b/);
  if (mdp) return Math.round(Number(mdp[1].replace(',', '.')) * 1_000_000);
  return null;
}

function matchesBuyOpenSearchPattern(t, raw) {
  if (isExplicitFlowSwitchToBuy(raw)) return true;
  if (/\bbusco\b/.test(t) && /\bcasa\b/.test(t)) return true;
  if (/\bbusco\b/.test(t) && /\bcomprar\b/.test(t)) return true;
  if (/\b(?:quiero|necesito)\s+comprar\b/.test(t)) return true;
  if (/\bbusco\b/.test(t) && /\ben\s+[a-záéíóúñ]/i.test(String(raw || ''))) return true;
  if (/\bbusco\b/.test(t) && /\balgo\b/.test(t)) return true;
  if (/\bbusco\b/.test(t) && parseMoneyAmount(raw) != null) return true;
  if (/\b(?:presupuesto|credito|crédito)\b/.test(t) && /\b(?:comprar|casa|depa)\b/.test(t)) return true;
  return false;
}

function applyBuyDemandPatch(patch, raw, decision) {
  patch.conversationGoal = CONVERSATION_GOALS.BUY_PROPERTY;
  patch.leadFlow = 'demand';
  patch.operationType = 'sale';
  const zoneBuy = extractLooseLocationPhrase(raw) || normalizeLocationFromUserText(raw);
  if (zoneBuy) {
    patch.locationText = zoneBuy;
    decision.extractedEntities.locationText = zoneBuy;
  }
  const prop = parsePropertyType(raw);
  if (prop) applyPropertyTypePatch(patch, prop);
  const amount = parseMoneyAmount(raw);
  if (amount != null) {
    patch.budget = amount;
    decision.extractedEntities.budget = amount;
  }
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
  return (
    t.includes('quiero vender') ||
    t.includes('vender mi') ||
    t.includes('poner en venta') ||
    t.includes('mejor quiero vender') ||
    t.includes('en realidad quiero vender')
  );
}

function isRentOutIntent(text) {
  const t = normalizeText(text);
  return (
    t.includes('poner en renta') ||
    t.includes('rentar mi') ||
    t.includes('rentarla') ||
    (t.includes('renta') &&
      (t.includes('mi casa') || t.includes('mi departamento') || t.includes('mi propiedad')))
  );
}

function isOfferFlow(state) {
  return (
    state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY ||
    state.conversationGoal === CONVERSATION_GOALS.RENT_OUT_PROPERTY ||
    state.leadFlow === 'offer'
  );
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

/** Mensaje de usuario que indica solo preferencia por WhatsApp (texto ya normalizado o mixto). */
const WHATSAPP_ONLY_REPLY = /^(?:wa|whatsapp|por\s+wa|por\s+whatsapp)$/i;

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
 * @param {{ campaignHeadline?: string|null }} [options]
 */
function interpretUserMessage(state, text, options = {}) {
  const t = normalizeText(String(text || ''));
  const raw = cleanSpaces(String(text || ''));
  const decision = createEmptyDecision();
  /** @type {Partial<import('../types/conversationState').ConversationState>} */
  const patch = { lastUserText: raw };

  const headline = options.campaignHeadline != null ? String(options.campaignHeadline).slice(0, 400) : null;
  if (headline) {
    patch.campaignHeadline = headline;
  }

  const sellFromRentLocked =
    state.conversationGoalLocked &&
    state.conversationGoal === CONVERSATION_GOALS.RENT_PROPERTY &&
    isExplicitFlowSwitchToSellFromRent(text);

  const strongSellEarly =
    isExplicitFlowSwitchToSell(text) || matchesSellerAcquisitionPattern(t) || sellFromRentLocked;
  const weakSellEarly = t.includes('vender') && t.includes('casa') && !state.conversationGoalLocked;
  if (strongSellEarly || weakSellEarly) {
    decision.detectedIntent = V3_INTENT.SELL_PROPERTY;
    decision.confidence = 0.9;
    decision.explicitFlowSwitch =
      !state.conversationGoalLocked ||
      isExplicitFlowSwitchToSell(text) ||
      sellFromRentLocked ||
      matchesSellerAcquisitionPattern(t);
    patch.conversationGoal = CONVERSATION_GOALS.SELL_PROPERTY;
    patch.leadFlow = 'offer';
    patch.operationType = 'sale';
    applyPropertyTypePatch(patch, parsePropertyType(text) || 'house');
    const zoneSellEarly = extractLooseLocationPhrase(raw);
    if (zoneSellEarly) {
      patch.locationText = zoneSellEarly;
      decision.extractedEntities.locationText = zoneSellEarly;
    }
    decision.shouldAskName = !state.collectedFields?.fullName;
    decision.nextSuggestedStage = state.collectedFields?.fullName
      ? CONVERSATION_STAGES.QUALIFYING
      : CONVERSATION_STAGES.IDENTITY_PENDING;
    return { patch, decision };
  }

  const codeHit = extractPropertyListingCode(raw);
  const persistedCode = state.propertyListingCode || null;
  const effectiveCode = (codeHit && codeHit.normalized) || persistedCode;

  const lockedSellBlocksPropertyCode =
    state.conversationGoalLocked &&
    state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY &&
    !isExplicitPropertyInquiryPhrase(raw);

  /** Ya en PROPERTY_INQUIRY con código guardado: no re-disparar el bloque con cada turno (nombre, consentimiento, etc.). */
  const propertyInquiryContinuationOnly =
    state.conversationGoalLocked &&
    state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY &&
    persistedCode &&
    !codeHit &&
    !isExplicitPropertyInquiryPhrase(raw);

  /** Ya en Q&A de propiedad: no re-disparar intake por palabras sueltas ("precio", "disponible" en preguntas). */
  const skipPropertyIntakeReentry =
    state.conversationGoal === CONVERSATION_GOALS.PROPERTY_INQUIRY &&
    !!persistedCode &&
    state.propertySubMode === 'PROPERTY_QA' &&
    !(codeHit && codeHit.normalized && codeHit.normalized !== persistedCode);

  if (
    !skipPropertyIntakeReentry &&
    !lockedSellBlocksPropertyCode &&
    effectiveCode &&
    (codeHit || isExplicitPropertyInquiryPhrase(raw) || persistedCode) &&
    !propertyInquiryContinuationOnly
  ) {
    const rentAsDemand = mentionsRentDemand(t) && !isRentOutIntent(text);
    if (rentAsDemand) {
      decision.detectedIntent = V3_INTENT.RENT_PROPERTY;
      decision.confidence = 0.88;
      decision.explicitFlowSwitch = state.conversationGoalLocked ? isExplicitFlowSwitchToRentDemand(text) : true;
      patch.conversationGoal = CONVERSATION_GOALS.RENT_PROPERTY;
      patch.leadFlow = 'demand';
      patch.operationType = 'rent';
      patch.propertyListingCode = effectiveCode;
      patch.propertySpecificIntent = true;
      const zone = extractLooseLocationPhrase(raw);
      if (zone) {
        patch.locationText = zone;
        decision.extractedEntities.locationText = zone;
      }
      decision.shouldAskName = !state.collectedFields?.fullName;
      decision.shouldSearchProperty = true;
      return { patch, decision };
    }

    decision.detectedIntent = V3_INTENT.PROPERTY_INQUIRY;
    decision.confidence = codeHit ? 0.9 : 0.82;
    decision.explicitFlowSwitch =
      !state.conversationGoalLocked || !!codeHit || isExplicitPropertyInquiryPhrase(raw);
    patch.conversationGoal = CONVERSATION_GOALS.PROPERTY_INQUIRY;
    patch.leadFlow = 'demand';
    patch.operationType = 'sale';
    patch.propertyListingCode = effectiveCode;
    patch.propertySpecificIntent = true;
    const zone = extractLooseLocationPhrase(raw);
    if (zone) {
      patch.locationText = zone;
      decision.extractedEntities.locationText = zone;
    }
    decision.shouldAskName = !state.collectedFields?.fullName;
    decision.shouldSearchProperty = true;
    return { patch, decision };
  }

  const sellCtx = isOfferFlow(state);
  const qualLocation = isV3HandoffEnabled()
    ? tryParseQualificationLocation(state, raw)
    : tryParseSellLocation(state, raw);
  const sellLocation = qualLocation;
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

  const awaitingNameCapture = isAwaitingIdentityName(state) && !state.collectedFields?.fullName;

  if (awaitingNameCapture && state.awaitingField === 'full_name') {
    const tw = normalizeText(raw);
    if (WHATSAPP_ONLY_REPLY.test(tw)) {
      decision.detectedIntent = V3_INTENT.UNKNOWN;
      decision.confidence = 0.58;
      patch.channelPreference = 'whatsapp';
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
  }

  if (awaitingNameCapture) {
    const split = splitNameAndTail(raw);
    if (split && isLikelyFirstNameOnly(split.name)) {
      const tailNorm = normalizeText(split.tail);
      const ch = parseChannelPreference(tailNorm);
      const channelOnlyTail = WHATSAPP_ONLY_REPLY.test(tailNorm.trim());
      const consent = channelOnlyTail ? null : parseAdvisorContactConsent(split.tail);
      patch.collectedFields = { ...(patch.collectedFields || {}), fullName: split.name };
      decision.extractedEntities.fullName = split.name;
      decision.shouldAskName = false;
      if (ch) patch.channelPreference = ch;
      if (consent === 'ACCEPTED') {
        patch.advisorContactConsent = 'ACCEPTED';
        patch.awaitingField = null;
        decision.detectedIntent = V3_INTENT.ADVISOR_CONSENT_CAPTURE;
        decision.confidence = 0.94;
      } else {
        decision.detectedIntent = V3_INTENT.IDENTITY_CAPTURE;
        decision.confidence = 0.93;
      }
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
  }

  const qaTurn = classifyPropertyInquiryTurn(state, text, raw);
  if (qaTurn && state.propertySubMode === 'PROPERTY_QA') {
    patch.propertyQaUserTurnCount = (state.propertyQaUserTurnCount || 0) + 1;
    if (qaTurn.kind === 'HUMAN_HANDOFF') {
      decision.detectedIntent = V3_INTENT.PROPERTY_HUMAN_HANDOFF_REQUEST;
      decision.confidence = 0.88;
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
    if (qaTurn.kind === 'FACT') {
      decision.detectedIntent = V3_INTENT.PROPERTY_FACT_QUESTION;
      decision.propertyInquiryFamily = qaTurn.family;
      decision.confidence = 0.82;
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
    if (qaTurn.kind === 'SOFT_CLOSE') {
      decision.detectedIntent = V3_INTENT.PROPERTY_QA_SOFT_CLOSE;
      decision.confidence = 0.72;
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
  }

  let consentParsed = null;
  if (shouldParseConsentTurn(state)) {
    const tn = normalizeText(text);
    if (WHATSAPP_ONLY_REPLY.test(tn)) {
      consentParsed = 'ACCEPTED';
      patch.channelPreference = 'whatsapp';
    } else {
      consentParsed = parseAdvisorContactConsent(text);
    }
  }
  if (consentParsed && shouldParseConsentTurn(state)) {
    decision.detectedIntent = V3_INTENT.ADVISOR_CONSENT_CAPTURE;
    decision.confidence = 0.93;
    patch.advisorContactConsent = consentParsed;
    patch.awaitingField = null;
    decision.explicitFlowSwitch = false;
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

  if (
    matchesBuyOpenSearchPattern(t, raw) &&
    (!state.conversationGoalLocked || isExplicitFlowSwitchToBuy(text))
  ) {
    decision.detectedIntent = V3_INTENT.BUY_PROPERTY;
    decision.confidence = 0.85;
    decision.explicitFlowSwitch = !state.conversationGoalLocked || isExplicitFlowSwitchToBuy(text);
    applyBuyDemandPatch(patch, raw, decision);
    decision.shouldAskName = !state.collectedFields?.fullName;
    return { patch, decision };
  }

  if (isRentOutIntent(text) && (!state.conversationGoalLocked || isExplicitFlowSwitchToRentOut(text))) {
    decision.detectedIntent = V3_INTENT.RENT_OUT_PROPERTY;
    decision.confidence = 0.85;
    decision.explicitFlowSwitch = state.conversationGoalLocked ? isExplicitFlowSwitchToRentOut(text) : true;
    patch.conversationGoal = CONVERSATION_GOALS.RENT_OUT_PROPERTY;
    patch.leadFlow = 'offer';
    patch.operationType = 'rent';
    applyPropertyTypePatch(patch, parsePropertyType(text) || null);
    decision.shouldAskName = !state.collectedFields?.fullName;
    return { patch, decision };
  }

  const wantsRentPhrase =
    t.includes('rentar') || t.includes('arrendar') || (t.includes('renta') && t.includes('busco'));
  if (wantsRentPhrase && (!state.conversationGoalLocked || isExplicitFlowSwitchToRentDemand(text))) {
    decision.detectedIntent = V3_INTENT.RENT_PROPERTY;
    decision.confidence = 0.8;
    decision.explicitFlowSwitch = state.conversationGoalLocked ? isExplicitFlowSwitchToRentDemand(text) : true;
    patch.conversationGoal = CONVERSATION_GOALS.RENT_PROPERTY;
    patch.leadFlow = 'demand';
    patch.operationType = 'rent';
    decision.shouldAskName = !state.collectedFields?.fullName;
    return { patch, decision };
  }

  const sellCtxEarly = isOfferFlow(state);
  const buyCtxEarly = state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY;
  const propTypeEarly = parsePropertyType(text);
  if (propTypeEarly && buyCtxEarly) {
    decision.detectedIntent = V3_INTENT.PROPERTY_TYPE_CAPTURE;
    decision.confidence = 0.9;
    applyPropertyTypePatch(patch, propTypeEarly);
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }
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

  const payMethod = parsePaymentMethod(text);
  if (payMethod && state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
    patch.paymentMethod = payMethod;
    decision.detectedIntent = V3_INTENT.UNKNOWN;
    decision.confidence = 0.8;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  const amount = parseMoneyAmount(text);
  if (amount != null) {
    if (isOfferFlow(state)) {
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

  if (isThinGenericInbound(t)) {
    if (state.conversationGoalLocked) {
      decision.detectedIntent = V3_INTENT.UNKNOWN;
      decision.confidence = 0.48;
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
    decision.detectedIntent = V3_INTENT.CAMPAIGN_GENERIC_TOUCH;
    decision.confidence = headline ? 0.62 : 0.45;
    decision.explicitFlowSwitch = false;
    decision.nextSuggestedStage = CONVERSATION_STAGES.UNDERSTANDING;
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
