'use strict';

/** @enum {string} */
const CONVERSATION_STAGES = Object.freeze({
  NEW: 'NEW',
  UNDERSTANDING: 'UNDERSTANDING',
  IDENTITY_PENDING: 'IDENTITY_PENDING',
  QUALIFYING: 'QUALIFYING',
  PROPERTY_CONTEXT: 'PROPERTY_CONTEXT',
  /** @deprecated F3.1+ usar QUALIFICATION_COMPLETE */
  READY_FOR_CRM: 'READY_FOR_CRM',
  QUALIFICATION_COMPLETE: 'QUALIFICATION_COMPLETE',
  HANDOFF_PENDING: 'HANDOFF_PENDING',
  HANDOFF_READY: 'HANDOFF_READY',
  CRM_READY: 'CRM_READY',
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
  PROPERTY_INQUIRY: 'PROPERTY_INQUIRY',
  CAMPAIGN_GENERIC_TOUCH: 'CAMPAIGN_GENERIC_TOUCH',
  IDENTITY_CAPTURE: 'IDENTITY_CAPTURE',
  LOCATION_CAPTURE: 'LOCATION_CAPTURE',
  SELLER_PRICE: 'SELLER_PRICE',
  BUYER_BUDGET: 'BUYER_BUDGET',
  BEDROOMS_CAPTURE: 'BEDROOMS_CAPTURE',
  PROPERTY_TYPE_CAPTURE: 'PROPERTY_TYPE_CAPTURE',
  OCCUPANCY_CAPTURE: 'OCCUPANCY_CAPTURE',
  ADVISOR_CONSENT_CAPTURE: 'ADVISOR_CONSENT_CAPTURE',
  /** F3.3A — pregunta factual sobre la propiedad (familia en `decision.propertyInquiryFamily`). */
  PROPERTY_FACT_QUESTION: 'PROPERTY_FACT_QUESTION',
  /** Usuario pide visita / asesor / coordinación humana explícita. */
  PROPERTY_HUMAN_HANDOFF_REQUEST: 'PROPERTY_HUMAN_HANDOFF_REQUEST',
  /** Cierre suave post-respuesta (gracias / ok) para permitir handoff sin forzar en pregunta. */
  PROPERTY_QA_SOFT_CLOSE: 'PROPERTY_QA_SOFT_CLOSE',
  RENT_OUT_PROPERTY: 'RENT_OUT_PROPERTY',
  FRUSTRATION: 'FRUSTRATION',
  /** M1 — rapport social sin reiniciar menú global. */
  SOCIAL_RAPPORT: 'SOCIAL_RAPPORT',
  /** M1-D — ajuste de criterios en flujo compra sin reiniciar. */
  DEMAND_REFINEMENT: 'DEMAND_REFINEMENT',
  UNKNOWN: 'UNKNOWN',
});

/** Submodo PROPERTY_INQUIRY (F3.3A). */
const PROPERTY_SUB_MODE = Object.freeze({
  PROPERTY_QA: 'PROPERTY_QA',
  HANDOFF_OFFERED: 'HANDOFF_OFFERED',
});

/** @enum {string} */
const CONVERSATION_GOALS = Object.freeze({
  SELL_PROPERTY: 'SELL_PROPERTY',
  BUY_PROPERTY: 'BUY_PROPERTY',
  RENT_PROPERTY: 'RENT_PROPERTY',
  RENT_OUT_PROPERTY: 'RENT_OUT_PROPERTY',
  PROPERTY_INQUIRY: 'PROPERTY_INQUIRY',
});

/** @enum {string} */
const ADVISOR_CONTACT_CONSENT = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  REQUESTED: 'REQUESTED',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
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
  ADVISOR_CONTACT_CONSENT,
  PROPERTY_SUB_MODE,
  ALL_STAGES,
  FORBIDDEN_COMPOSER_PATTERNS,
};
