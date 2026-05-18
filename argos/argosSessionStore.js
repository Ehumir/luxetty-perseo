'use strict';

const crypto = require('crypto');
const { getDefaultAiState } = require('../conversation/aiState');

/** @type {Map<string, object>} */
const sessions = new Map();

function createSession({ phone_sim, flags = {} }) {
  const session_id = crypto.randomUUID();
  const row = {
    session_id,
    phone_sim,
    flags: { ...flags },
    turn_count: 0,
    assistant_replies_consecutive: 0,
    transcript: [],
    legacy_ai_state: getDefaultAiState(),
    contact_id: null,
    lead_id: null,
    qa_crm_force_new_lead: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  sessions.set(session_id, row);
  return row;
}

function getSession(session_id) {
  return sessions.get(session_id) || null;
}

function updateSession(session_id, patch) {
  const row = sessions.get(session_id);
  if (!row) return null;
  Object.assign(row, patch, { updated_at: new Date().toISOString() });
  sessions.set(session_id, row);
  return row;
}

function appendTranscript(session_id, entry) {
  const row = getSession(session_id);
  if (!row) return null;
  row.transcript.push({ at: new Date().toISOString(), ...entry });
  sessions.set(session_id, row);
  return row;
}

function resetSession(session_id, { mode = 'crm' } = {}) {
  const row = getSession(session_id);
  if (!row) return null;

  if (mode === 'full') {
    row.legacy_ai_state = getDefaultAiState();
    row.contact_id = null;
    row.lead_id = null;
    row.qa_crm_force_new_lead = false;
    row.transcript = [];
    row.turn_count = 0;
    row.assistant_replies_consecutive = 0;
  } else {
    row.contact_id = null;
    row.lead_id = null;
    row.qa_crm_force_new_lead = true;
    if (row.legacy_ai_state && typeof row.legacy_ai_state === 'object') {
      row.legacy_ai_state.qa_crm_force_new_lead = true;
      delete row.legacy_ai_state.contact_id;
      delete row.legacy_ai_state.lead_id;
    }
  }
  row.updated_at = new Date().toISOString();
  sessions.set(session_id, row);
  return row;
}

function deleteSession(session_id) {
  return sessions.delete(session_id);
}

function clearAllSessionsForTests() {
  sessions.clear();
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  appendTranscript,
  resetSession,
  deleteSession,
  clearAllSessionsForTests,
};
