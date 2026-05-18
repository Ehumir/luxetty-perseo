'use strict';

const { cleanSpaces, normalizeText } = require('../../../utils/text');
const { FORBIDDEN_COMPOSER_PATTERNS } = require('../types/constants');
const { composeFromPlannerContext } = require('./slotTemplates');
const { pickOpeningVariant, GLOBAL_OPENING_VARIANTS } = require('./openingVariantPicker');

function assertComposerQuality(text) {
  const s = String(text || '');
  for (const p of FORBIDDEN_COMPOSER_PATTERNS) {
    if (p.test(s)) return false;
  }
  return s.length > 0;
}

function normalizeQuestionForDedupe(text) {
  return normalizeText(String(text || ''))
    .replace(/[¿?]/g, '')
    .trim();
}

/**
 * @param {{ state: object, decision: object, plannerOut: object, handoffOut: object }} input
 */
function composePlannerResponse(input) {
  return composeFromPlannerContext(
    input.state || {},
    input.decision || {},
    input.plannerOut || {},
    input.handoffOut || {}
  );
}

/**
 * @param {{ state: object, decision: object, plannerOut: object, handoffOut: object }} input
 */
function composePlannerReplyText(input) {
  const out = composePlannerResponse(input);
  let merged = cleanSpaces(out.responseText || '');
  const followUp = cleanSpaces(out.followUpQuestion || '');
  const bodyHasQuestion = /¿/.test(merged);
  if (followUp && !bodyHasQuestion) {
    const bodyNorm = normalizeQuestionForDedupe(merged);
    const fuNorm = normalizeQuestionForDedupe(followUp);
    if (!fuNorm || !bodyNorm.includes(fuNorm)) {
      merged = cleanSpaces(`${merged} ${followUp}`);
    }
  }
  merged = merged.replace(/\s+/g, ' ').trim();
  if (!assertComposerQuality(merged)) {
    return pickOpeningVariant(input.state || {}, [...GLOBAL_OPENING_VARIANTS]);
  }
  return merged;
}

module.exports = {
  composePlannerResponse,
  composePlannerReplyText,
  assertComposerQuality,
};
