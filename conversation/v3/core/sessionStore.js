'use strict';

/** @type {Map<string, import('../types/conversationState').ConversationState>} */
const sessions = new Map();

function sessionKey(conversationId) {
  return String(conversationId || '').trim();
}

function getSession(conversationId) {
  return sessions.get(sessionKey(conversationId)) || null;
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
  setSession,
  clearSession,
  resetSession,
};
