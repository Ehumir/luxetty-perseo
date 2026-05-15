'use strict';

/** @enum {string} */
const CONVERSATION_STAGES = Object.freeze({
  NEW: 'NEW',
  UNDERSTANDING: 'UNDERSTANDING',
  IDENTITY_PENDING: 'IDENTITY_PENDING',
  QUALIFYING: 'QUALIFYING',
  PROPERTY_CONTEXT: 'PROPERTY_CONTEXT',
  READY_FOR_CRM: 'READY_FOR_CRM',
  HANDOFF_READY: 'HANDOFF_READY',
  HUMAN_ESCALATION: 'HUMAN_ESCALATION',
  CLOSED: 'CLOSED',
});

/** @enum {string} */
const IDENTITY_STATES = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  PARTIAL: 'PARTIAL',
  CONFIRMED: 'CONFIRMED',
});

/** @enum {string} */
const CONVERSATION_MODE = Object.freeze({
  AI: 'ai',
  HUMAN: 'human',
});

/** @enum {string} */
const FRUSTRATION_STATES = Object.freeze({
  NONE: 'none',
  MILD: 'mild',
  ELEVATED: 'elevated',
});

const ALL_STAGES = new Set(Object.values(CONVERSATION_STAGES));

module.exports = {
  CONVERSATION_STAGES,
  IDENTITY_STATES,
  CONVERSATION_MODE,
  FRUSTRATION_STATES,
  ALL_STAGES,
};
