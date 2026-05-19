'use strict';

const { DECISIONS } = require('../policy/PolicyEngine');

/**
 * @param {{
 *   segments: object[],
 *   policyResult: object|null,
 *   state: object,
 * }} input
 * @returns {object[]}
 */
function buildResponsePlan(input) {
  const segments = input.segments || [];
  const policy = input.policyResult;
  const plan = [];

  if (segments.length > 1) {
    plan.push({
      type: 'acknowledge_dual',
      order: 1,
      text: 'Entiendo que quieres avanzar con más de un tema en el mismo mensaje; los ordeno por partes para no mezclar datos.',
    });
  }

  if (policy?.blockingDecline && policy.hasDualIntent) {
    plan.push({
      type: 'policy_decline',
      order: 2,
      segment_index: policy.blockingDecline.segment_index,
      rule_id: policy.blockingDecline.rule_id,
    });
    plan.push({
      type: 'qualify',
      order: 3,
      text: 'Sobre la parte de compra, ¿en qué zona buscas y con qué presupuesto aproximado?',
    });
    return plan;
  }

  if (policy?.decision === DECISIONS.DECLINE_SOFT) {
    plan.push({ type: 'policy_decline', order: 1, rule_id: policy.rule_id });
    return plan;
  }

  if (policy?.decision === DECISIONS.QUALIFY || policy?.decision === DECISIONS.DEFER) {
    plan.push({
      type: 'qualify',
      order: 1,
      text: 'Para orientarte bien, ¿me compartes zona y rango aproximado?',
    });
    return plan;
  }

  const questions = segments.filter((s) => (s.text.match(/\?/g) || []).length > 0);
  if (questions.length >= 2) {
    plan.push({
      type: 'acknowledge_multi_question',
      order: 1,
      text: 'Voy por partes para responderte con claridad.',
    });
    plan.push({
      type: 'focus_question',
      order: 2,
      text: segments[0]?.text?.slice(0, 120) || null,
    });
  }

  if (!plan.length) {
    plan.push({ type: 'continue', order: 1 });
  }

  return plan;
}

module.exports = {
  buildResponsePlan,
};
