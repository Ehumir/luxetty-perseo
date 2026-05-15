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

/** @enum {string} */
const V3_INTENT = Object.freeze({
  GREETING: 'GREETING',
  SELL_PROPERTY: 'SELL_PROPERTY',
  BUY_PROPERTY: 'BUY_PROPERTY',
  RENT_PROPERTY: 'RENT_PROPERTY',
  IDENTITY_CAPTURE: 'IDENTITY_CAPTURE',
  LOCATION_CAPTURE: 'LOCATION_CAPTURE',
  SELLER_PRICE: 'SELLER_PRICE',
  BUYER_BUDGET: 'BUYER_BUDGET',
  BEDROOMS_CAPTURE: 'BEDROOMS_CAPTURE',
  PROPERTY_TYPE_CAPTURE: 'PROPERTY_TYPE_CAPTURE',
  FRUSTRATION: 'FRUSTRATION',
  UNKNOWN: 'UNKNOWN',
});

/** @enum {string} */
const CONVERSATION_GOALS = Object.freeze({
  SELL_PROPERTY: 'SELL_PROPERTY',
  BUY_PROPERTY: 'BUY_PROPERTY',
  RENT_PROPERTY: 'RENT_PROPERTY',
});

const ALL_STAGES = new Set(Object.values(CONVERSATION_STAGES));

const FORBIDDEN_COMPOSER_PATTERNS = [
  /\btu house\b/i,
  /\bhouse\b/i,
  /dime en una frase/i,
  /en una linea/i,
  /en una línea/i,
  /que necesitas revisar/i,
  /listo,\s*retomo/i,
  /listo retomo/i,
];

module.exports = {
  CONVERSATION_STAGES,
  IDENTITY_STATES,
  CONVERSATION_MODE,
  FRUSTRATION_STATES,
  V3_INTENT,
  CONVERSATION_GOALS,
  ALL_STAGES,
  FORBIDDEN_COMPOSER_PATTERNS,
};
