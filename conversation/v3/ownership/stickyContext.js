'use strict';

/**
 * Sticky context (M1-B) — ancla de intención tras lock de goal.
 *
 * ## Cuándo se FIJA (stamp)
 * - Tras `conversationGoalLocked === true` con goal/lead/operation resueltos en `applyGoalOwnership`.
 * - Requiere intención fuerte del intérprete (típ. `decision.confidence >= 0.8` en SELL/BUY/RENT).
 * - Persiste en `stickyConversationGoal`, `stickyLeadFlow`, `stickyOperationType`.
 *
 * ## Cuándo se MANTIENE (enforce)
 * - Cada turno mientras `isStickyContextActive(state)` y `explicitFlowSwitch === false`.
 * - Bloquea degradación offer↔demand y re-aplica goal/operation anclados.
 * - No impide captura de slots (zona, precio, nombre); solo protege clasificación de flujo.
 *
 * ## Cuándo se LIBERA (release + re-stamp)
 * - `decision.explicitFlowSwitch === true`: frases de cambio real de objetivo
 *   (ej. "ya no quiero vender, mejor quiero comprar", "en realidad busco rentar").
 * - `releaseStickyContext` borra anclas; el turno actual puede fijar nuevas vía `stampStickyContext`.
 * - Sin frase explícita, mensajes ambiguos/cortos NO liberan sticky.
 *
 * ## Confianza
 * - Lock inicial: ownership + interpreter (no sticky suelto en saludo genérico).
 * - Sticky no sustituye al parser de slots; solo protege `leadFlow` / `operationType` / `conversationGoal`.
 */

const { CONVERSATION_GOALS } = require('../types/constants');

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function isStickyContextActive(state) {
  return !!(
    state &&
    (state.stickyLeadFlow ||
      (state.conversationGoalLocked === true && (state.leadFlow || state.conversationGoal)))
  );
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function getStickyLeadFlow(state) {
  return state.stickyLeadFlow || state.leadFlow || null;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function getStickyOperationType(state) {
  return state.stickyOperationType || state.operationType || null;
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function getStickyConversationGoal(state) {
  return state.stickyConversationGoal || state.conversationGoal || null;
}

/**
 * Libera anclas sticky para permitir cambio real de objetivo.
 * @param {Partial<import('../types/conversationState').ConversationState>} patch
 */
function releaseStickyContext(patch) {
  patch.stickyConversationGoal = null;
  patch.stickyLeadFlow = null;
  patch.stickyOperationType = null;
}

/**
 * Persiste ancla de flujo al primer lock de goal.
 * @param {Partial<import('../types/conversationState').ConversationState>} patch
 */
function stampStickyContext(patch) {
  if (!patch.conversationGoalLocked) return;
  const goal = patch.conversationGoal;
  const lead = patch.leadFlow;
  const op = patch.operationType;
  if (goal) patch.stickyConversationGoal = goal;
  if (lead) patch.stickyLeadFlow = lead;
  if (op) patch.stickyOperationType = op;
}

/**
 * Reaplica ancla sticky; impide degradación por ruido conversacional.
 * @param {import('../types/conversationState').ConversationState} state
 * @param {Partial<import('../types/conversationState').ConversationState>} patch
 * @param {import('../types/conversationDecision').ConversationDecision} decision
 */
function enforceStickyContext(state, patch, decision) {
  if (!isStickyContextActive(state) && !patch.conversationGoalLocked) {
    return patch;
  }

  const out = { ...patch };
  const stickyGoal = state.stickyConversationGoal || getStickyConversationGoal(state);
  const stickyLead = state.stickyLeadFlow || getStickyLeadFlow(state);
  const stickyOp = state.stickyOperationType || getStickyOperationType(state);

  if (stickyGoal && !decision.explicitFlowSwitch) {
    out.conversationGoal = stickyGoal;
  }
  if (stickyLead && !decision.explicitFlowSwitch) {
    out.leadFlow = stickyLead;
  }
  if (stickyOp && !decision.explicitFlowSwitch) {
    out.operationType = stickyOp;
  }

  if (decision.explicitFlowSwitch) {
    releaseStickyContext(out);
    return out;
  }

  if (stickyGoal === CONVERSATION_GOALS.SELL_PROPERTY && out.budget != null && out.expectedPrice == null) {
    out.expectedPrice = out.budget;
    out.budget = null;
  }

  if (stickyLead === 'offer' && out.leadFlow === 'demand') {
    delete out.leadFlow;
    out.leadFlow = stickyLead;
  }
  if (stickyLead === 'demand' && out.leadFlow === 'offer') {
    delete out.leadFlow;
    out.leadFlow = stickyLead;
  }

  return out;
}

module.exports = {
  isStickyContextActive,
  getStickyLeadFlow,
  getStickyOperationType,
  getStickyConversationGoal,
  releaseStickyContext,
  stampStickyContext,
  enforceStickyContext,
};
