'use strict';

const { CONVERSATION_GOALS } = require('../types/constants');
const { evaluateQualification } = require('../planner/qualificationPlanner');
const { firstName } = require('./postHandoffComposer');

function formatMoneyMx(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString('es-MX')}`;
  }
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function composeContextualConfusionReply(state) {
  const planner = evaluateQualification(state);
  const slot = planner.nextSlot;
  let need = 'un dato más';
  if (slot === 'full_name') need = 'tu nombre';
  else if (slot === 'location_text') need = 'la zona';
  else if (slot === 'budget') need = 'tu presupuesto aproximado';
  else if (slot === 'expected_price') need = 'el precio esperado';

  const goal =
    state.conversationGoal === CONVERSATION_GOALS.SELL_PROPERTY
      ? 'registrar tu venta'
      : state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY
        ? 'afinar tu búsqueda de compra'
        : 'orientarte';

  return {
    responseText: `Sin problema. Para ${goal} solo me falta ${need} — es rápido. ¿Me lo compartes?`,
    followUpQuestion: null,
    awaitingField: slot || state.awaitingField,
    toneFlags: { empathetic: true, humanity: true },
  };
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 */
function composeCurtDirectReply(state) {
  const zone = state.locationText || 'esa zona';
  const pres = state.budget != null ? formatMoneyMx(state.budget) : null;
  const nm = firstName(state);
  const needName = !state.collectedFields?.fullName;

  if (state.conversationGoal === CONVERSATION_GOALS.BUY_PROPERTY) {
    const tail = needName ? '¿Cómo te llamas?' : '¿Quieres que un asesor te contacte?';
    const core = pres
      ? `No cierro precios por chat. Con ${pres} en ${zone} un asesor te muestra opciones reales.`
      : `No invento precios aquí; en ${zone} un asesor te muestra opciones reales.`;
    return {
      responseText: nm ? `${nm}, ${core} ${tail}` : `${core} ${tail}`,
      followUpQuestion: null,
      awaitingField: needName ? 'full_name' : state.awaitingField,
      toneFlags: { brief: true, humanity: true },
    };
  }

  return {
    responseText: 'No invento cifras por chat. Un asesor de Luxetty puede darte datos reales sin compromiso.',
    followUpQuestion: null,
    awaitingField: state.awaitingField,
    toneFlags: { brief: true, humanity: true },
  };
}

/**
 * @param {import('../interpreter/objectionClassifier').ObjectionKind|null} kind
 */
function isHumanityDeferHandoffKind(kind) {
  return (
    kind === 'frustration_not_understood' ||
    kind === 'useless' ||
    kind === 'curt_direct_question' ||
    kind === 'sale_urgency_emotional'
  );
}

module.exports = {
  composeContextualConfusionReply,
  composeCurtDirectReply,
  isHumanityDeferHandoffKind,
};
