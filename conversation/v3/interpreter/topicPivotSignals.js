'use strict';

const { normalizeText, cleanSpaces } = require('../../../utils/text');
const { extractLooseLocationPhrase } = require('./campaignIntake');

function isSoftTopicDismissal(text) {
  const t = normalizeText(text);
  return (
    /\b(?:olvida|olvidar|dejemos|dej[aá]|cancela)\s+(?:eso|lo\s+anterior|lo\s+del)\b/.test(t) ||
    /\bcambiemos\s+de\s+tema\b/.test(t) ||
    /\bno\s+importa\s+lo\s+de\s+antes\b/.test(t)
  );
}

function isBudgetDismissalOnly(text) {
  const t = normalizeText(text);
  return /\b(?:olvida|olvidar|dejemos)\s+(?:lo\s+del\s+)?presupuesto\b/.test(t);
}

/**
 * @param {string} text
 * @returns {{ clearBudget: boolean, clearZone: boolean, newZone: string|null }}
 */
function parseTopicPivot(text) {
  const raw = String(text || '');
  const t = normalizeText(raw);
  const newZone = extractLooseLocationPhrase(raw);
  const clearBudget = isBudgetDismissalOnly(t) || (isSoftTopicDismissal(t) && !newZone);
  const clearZone = isSoftTopicDismissal(t) && !newZone;
  return {
    clearBudget,
    clearZone,
    newZone: newZone || null,
  };
}

module.exports = {
  isSoftTopicDismissal,
  isBudgetDismissalOnly,
  parseTopicPivot,
};
