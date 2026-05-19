'use strict';

const { normalizeText, cleanSpaces, normalizeMultilineText } = require('../../../utils/text');
const { isResilienceV1Enabled, isWaHardeningV2Enabled } = require('../../../config/perseoM302Flags');
const { isLikelyFirstNameOnly } = require('../interpreter/identityCompoundCapture');
const { isBareKnownZoneToken, normalizeLocationFromUserText } = require('../interpreter/locationNormalizer');
const { parseMoneyAmount } = require('../interpreter/moneyParser');
const { segmentMessage } = require('../understanding/messageSegmenter');
const { extractInlineZone } = require('../understanding/segmentSlotExtractor');

const INTERRUPT_TOKENS = new Set([
  'espera',
  'un momento',
  'sigo',
  'ok',
  'va',
  'listo',
]);

const GREET_TOKENS = new Set(['hola', 'hello', 'buenas', 'hey', 'hi']);

const QUESTION_MARK = /\?|¿/;

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractMultiQuestions(text) {
  const raw = normalizeMultilineText(text);
  if (!raw) return [];
  const parts = raw.match(/[^?¿]+[?¿]+/g) || [];
  return parts
    .map((p) => cleanSpaces(p))
    .filter((p) => p.length > 2 && p !== '¿' && p !== '?');
}

/**
 * @param {string} text
 */
function parseLongStorySlots(text) {
  const segments = segmentMessage(normalizeMultilineText(text));
  const patch = {};
  const entities = {};

  const fullAmount = parseMoneyAmount(text);
  if (fullAmount != null && patch.budget == null) {
    patch.budget = fullAmount;
    entities.budget = fullAmount;
  }
  const zm = String(text || '').match(/\b(?:en|zona)\s+([a-záéíóúñ][\wáéíóúñ\s]{2,40})/i);
  const zoneFromPhrase = zm?.[1] ? cleanSpaces(zm[1]) : null;
  const fullZone = normalizeLocationFromUserText(text) || extractInlineZone(text) || zoneFromPhrase;
  if (fullZone && !patch.locationText) {
    patch.locationText = fullZone;
    entities.zone = fullZone;
  }

  for (const seg of segments) {
    const line = String(seg.text || '').trim();
    if (!line) continue;
    const amount = parseMoneyAmount(line);
    if (amount != null && patch.budget == null) {
      patch.budget = amount;
      entities.budget = amount;
    }
    const zone =
      normalizeLocationFromUserText(line) ||
      extractInlineZone(line) ||
      (isBareKnownZoneToken(line) ? line : null);
    if (zone && !patch.locationText) {
      patch.locationText = zone;
      entities.zone = zone;
    }
    const lineNorm = normalizeText(line);
    if (INTERRUPT_TOKENS.has(lineNorm) || GREET_TOKENS.has(lineNorm)) continue;
    const words = line.split(/\s+/).filter(Boolean);
    if (
      words.length === 1 &&
      isLikelyFirstNameOnly(line) &&
      !isBareKnownZoneToken(line) &&
      !normalizeLocationFromUserText(line) &&
      !patch.collectedFields?.fullName
    ) {
      patch.collectedFields = { fullName: line };
      entities.name = line;
    }
  }

  return { patch, entities, segment_count: segments.length };
}

/**
 * @param {object} state
 * @param {string} text
 */
function detectInterruption(state, text) {
  const t = normalizeText(text);
  const wasAwaiting = !!(state.awaitingField || state.lastAskedField);
  const abrupt =
    /\b(espera|un momento|para|mejor|olvida|olvidalo|dejame|déjame|antes|otra cosa)\b/.test(t) ||
    (t.length < 24 && /\b(no|pero|ahora)\b/.test(t) && wasAwaiting);
  if (!abrupt) return { interrupted: false };
  return {
    interrupted: true,
    recovery_hint: 'acknowledge_and_resume',
    preserve_goal: state.conversationGoalLocked === true,
  };
}

/**
 * @param {object} state
 * @param {string} text
 */
function resolveAmbiguousReference(state, text) {
  const t = normalizeText(text);
  const patch = {};
  const history = Array.isArray(state.propertyHistory) ? state.propertyHistory : [];
  const activeCode = state.propertyListingCode || null;

  if (/\b(esa casa|ese depa|esa propiedad|ese inmueble)\b/.test(t) && activeCode) {
    patch.propertySpecificIntent = true;
    patch.propertyListingCode = activeCode;
    return { resolved: true, reference: 'active_listing', patch };
  }

  if (/\b(la otra|el otro|la anterior)\b/.test(t) && history.length >= 2) {
    const prev = history[1];
    if (prev?.code) {
      patch.propertyListingCode = prev.code;
      patch.propertySpecificIntent = true;
      return { resolved: true, reference: 'previous_listing', patch };
    }
  }

  if (/\b(esa zona|ese lugar)\b/.test(t) && state.locationText) {
    return { resolved: true, reference: 'active_zone', patch: {} };
  }

  return { resolved: false, patch: {} };
}

/**
 * @param {object} state
 * @param {string} text
 */
function scoreTopicPriority(state, text) {
  const t = normalizeText(text);
  let score = 0;
  if (/\b(comprar|busco|quiero comprar)\b/.test(t)) score += 3;
  if (/\b(vender|rentar mi|poner en venta)\b/.test(t)) score += 3;
  if (/\b(precio|disponible|visita|agendar)\b/.test(t)) score += 2;
  if (/\b(hola|gracias|ok|va)\b/.test(t) && t.length < 20) score -= 1;
  if (state.conversationGoalLocked) score += 1;
  return { score, primary: score >= 3 ? 'transactional' : 'social' };
}

/**
 * @param {object} state
 * @param {object} entities
 */
function mergeEntityTracker(state, entities) {
  const prev = state.entityTracker && typeof state.entityTracker === 'object' ? state.entityTracker : {};
  return { ...prev, ...entities, updated_at: new Date().toISOString() };
}

/**
 * @param {{ state: object, text: string, decision?: object }} input
 */
function runResilienceLayer(input) {
  if (!isResilienceV1Enabled() && !isWaHardeningV2Enabled()) return null;

  const state = input.state || {};
  const text = String(input.text || '');
  const questions = extractMultiQuestions(text);
  const longStory = parseLongStorySlots(text);
  const interruption = detectInterruption(state, text);
  const ambiguity = resolveAmbiguousReference(state, text);
  const priority = scoreTopicPriority(state, text);

  const patch = {
    ...(longStory.patch || {}),
    ...(ambiguity.patch || {}),
  };

  if (interruption.interrupted && interruption.preserve_goal) {
    patch.awaitingField = state.awaitingField;
  }

  const entityTracker = mergeEntityTracker(state, {
    ...longStory.entities,
    last_questions: questions.slice(0, 5),
    topic_priority: priority.primary,
  });

  return {
    questions,
    question_count: questions.length,
    long_story_segment_count: longStory.segment_count,
    interruption,
    ambiguity,
    priority,
    patch,
    entityTracker,
    metrics: {
      multi_question: questions.length > 1,
      long_story: longStory.segment_count >= 4,
      interruption: interruption.interrupted,
      ambiguity_resolved: ambiguity.resolved,
    },
  };
}

module.exports = {
  extractMultiQuestions,
  parseLongStorySlots,
  detectInterruption,
  resolveAmbiguousReference,
  scoreTopicPriority,
  runResilienceLayer,
};
