'use strict';

/** @type {Map<string, import('../types/conversationState').ConversationState>} */
const sessions = new Map();

function sessionKey(conversationId) {
  return String(conversationId || '').trim();
}

function getSession(conversationId) {
  return sessions.get(sessionKey(conversationId)) || null;
}

/**
 * Resuelve sesión V3: Map → hidratación desde `ai_state` (MC-5 read-through).
 * @param {string} conversationId
 * @param {{ phone?: string|null, legacyAiState?: object|null, readthrough?: boolean }} [options]
 */
function resolveSession(conversationId, options = {}) {
  const cached = getSession(conversationId);
  if (cached) return cached;

  const legacyAiState =
    options.legacyAiState && typeof options.legacyAiState === 'object' ? options.legacyAiState : null;
  if (!options.readthrough || !legacyAiState) return null;

  const { hydrateV3StateFromLegacyAiState } = require('../state/legacyToV3State');
  const phone = options.phone != null ? String(options.phone) : null;
  const hydrated = hydrateV3StateFromLegacyAiState(conversationId, phone, legacyAiState);
  if (!hydrated) return null;
  setSession(conversationId, hydrated);
  return hydrated;
}

function setSession(conversationId, state) {
  if (!conversationId || !state) return;
  sessions.set(sessionKey(conversationId), state);
}

function clearSession(conversationId) {
  sessions.delete(sessionKey(conversationId));
}

function resetSession(conversationId, seed = {}) {
  const { createInitialConversationState } = require('../types/conversationState');
  const st = createInitialConversationState({ conversationId, ...seed });
  setSession(conversationId, st);
  return st;
}

module.exports = {
  getSession,
  resolveSession,
  setSession,
  clearSession,
  resetSession,
};
