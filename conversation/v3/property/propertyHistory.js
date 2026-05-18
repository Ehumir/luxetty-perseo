'use strict';

const { cleanSpaces } = require('../../../utils/text');
const { normalizeText } = require('../../../utils/text');

/**
 * @param {Array<{ code: string, at?: string }>|null|undefined} history
 * @param {string} code
 */
function appendPropertyHistory(history, code) {
  const c = cleanSpaces(String(code || ''));
  if (!c) return Array.isArray(history) ? [...history] : [];
  const prev = Array.isArray(history) ? history.filter((h) => h && h.code !== c) : [];
  const entry = { code: c, at: new Date().toISOString() };
  return [entry, ...prev].slice(0, 5);
}

/**
 * Resuelve referencias ordinales a código de inventario.
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} text
 * @returns {string|null}
 */
function resolvePropertyReferenceCode(state, text) {
  const t = normalizeText(text);
  const hist = Array.isArray(state.propertyHistory) ? state.propertyHistory : [];
  if (!hist.length) return null;

  if (/\b(la\s+)?primera\b|\bprimera\s+propiedad\b|\bel\s+primero\b/.test(t)) {
    return cleanSpaces(String(hist[hist.length - 1]?.code || '')) || null;
  }
  if (/\b(la\s+)?ultima\b|\blo\s+ultimo\b|\bultima\s+propiedad\b/.test(t)) {
    return cleanSpaces(String(hist[0]?.code || '')) || null;
  }
  if (/\b(la\s+)?otra\b|\bese\s+otro\b|\bel\s+otro\b/.test(t) && hist.length >= 2) {
    return cleanSpaces(String(hist[0]?.code || '')) || null;
  }
  return null;
}

module.exports = {
  appendPropertyHistory,
  resolvePropertyReferenceCode,
};
