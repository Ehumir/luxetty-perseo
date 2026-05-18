'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');
const { V3_INTENT } = require('../types/constants');
const { parseMoneyAmount } = require('./moneyParser');
const { tryParseQualificationLocation } = require('./sellLocationCapture');
const { normalizeLocationFromUserText, isBareKnownZoneToken } = require('./locationNormalizer');
const { shouldAcceptAsIdentityName, isNonNameUtterance } = require('./nameHeuristics');
const { parseAdvisorContactConsent } = require('../planner/consentParser');
const { isSlotFilled } = require('../state/slotFillState');

/**
 * Campo que el asistente está esperando (prioridad sobre reclasificación de intención).
 * @param {import('../types/conversationState').ConversationState} state
 */
function resolveActiveAwaitingField(state) {
  if (state.awaitingField) return state.awaitingField;
  if (state.lastAskedField) return state.lastAskedField;
  return null;
}

/**
 * Interpreta mensajes cortos como respuesta al campo pendiente.
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} raw
 * @param {string} text
 * @param {Partial<import('../types/conversationState').ConversationState>} patch
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 * @returns {{ patch: object, decision: object }|null}
 */
function tryResolveAwaitingFieldCapture(state, raw, text, patch, decision) {
  const field = resolveActiveAwaitingField(state);
  if (!field || !state.conversationGoalLocked) return null;

  if (
    !state.locationText &&
    (field === 'location_text' || field === 'full_name') &&
    (isBareKnownZoneToken(raw) || normalizeLocationFromUserText(raw))
  ) {
    const loc =
      normalizeLocationFromUserText(raw) ||
      tryParseQualificationLocation(state, raw) ||
      cleanSpaces(String(raw || '')).slice(0, 120);
    if (loc && loc.length >= 2) {
      decision.detectedIntent = V3_INTENT.LOCATION_CAPTURE;
      decision.confidence = 0.93;
      patch.locationText = loc;
      patch.awaitingField = null;
      patch.lastAskedField = null;
      decision.extractedEntities.locationText = loc;
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
  }

  if (field === 'location_text') {
    const loc =
      tryParseQualificationLocation(state, raw) ||
      normalizeLocationFromUserText(raw) ||
      cleanSpaces(String(raw || '')).slice(0, 120);
    if (!loc || loc.length < 2) return null;
    decision.detectedIntent = V3_INTENT.LOCATION_CAPTURE;
    decision.confidence = 0.92;
    patch.locationText = loc;
    patch.awaitingField = null;
    patch.lastAskedField = null;
    decision.extractedEntities.locationText = loc;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  if (
    state.budget == null &&
    state.leadFlow === 'demand' &&
    (field === 'budget' || field === 'full_name' || field === 'location_text') &&
    parseMoneyAmount(text) != null
  ) {
    const amount = parseMoneyAmount(text);
    decision.detectedIntent = V3_INTENT.BUYER_BUDGET;
    patch.budget = amount;
    decision.extractedEntities.budget = amount;
    decision.confidence = 0.9;
    patch.awaitingField = null;
    patch.lastAskedField = null;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  if (
    !state.collectedFields?.fullName &&
    (field === 'full_name' || field === 'budget' || field === 'advisor_contact_consent') &&
    !isBareKnownZoneToken(raw) &&
    !normalizeLocationFromUserText(raw) &&
    shouldAcceptAsIdentityName(state, raw, { explicitNameMatch: false }) &&
    !isNonNameUtterance(raw)
  ) {
    const nameMatch = raw.match(/^(?:soy|me llamo|mi nombre es)\s+(.+)/i);
    const nm = cleanSpaces(nameMatch ? nameMatch[1] : String(raw || '').trim());
    if (nm) {
      patch.collectedFields = { ...(patch.collectedFields || {}), fullName: nm };
      decision.extractedEntities.fullName = nm;
      decision.detectedIntent = V3_INTENT.IDENTITY_CAPTURE;
      decision.confidence = 0.93;
      patch.awaitingField = null;
      patch.lastAskedField = null;
      decision.shouldAskName = false;
      decision.explicitFlowSwitch = false;
      return { patch, decision };
    }
  }

  if ((field === 'budget' || field === 'expected_price') && !isSlotFilled(state, field)) {
    const amount = parseMoneyAmount(text);
    if (amount == null) return null;
    if (field === 'expected_price' || state.leadFlow === 'offer') {
      decision.detectedIntent = V3_INTENT.SELLER_PRICE;
      patch.expectedPrice = amount;
      patch.budget = null;
      decision.extractedEntities.expectedPrice = amount;
    } else {
      decision.detectedIntent = V3_INTENT.BUYER_BUDGET;
      patch.budget = amount;
      decision.extractedEntities.budget = amount;
    }
    decision.confidence = 0.9;
    patch.awaitingField = null;
    patch.lastAskedField = null;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  if (field === 'advisor_contact_consent') {
    const consent = parseAdvisorContactConsent(text);
    if (!consent) return null;
    decision.detectedIntent = V3_INTENT.ADVISOR_CONSENT_CAPTURE;
    decision.confidence = 0.94;
    patch.advisorContactConsent = consent;
    patch.awaitingField = null;
    patch.lastAskedField = null;
    decision.explicitFlowSwitch = false;
    return { patch, decision };
  }

  return null;
}

module.exports = {
  resolveActiveAwaitingField,
  tryResolveAwaitingFieldCapture,
};
