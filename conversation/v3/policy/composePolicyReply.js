'use strict';

const { loadPolicyBundle } = require('./policyConfigLoader');
const { DECISIONS } = require('./PolicyEngine');

function templateForDecline(rule_id) {
  const t = loadPolicyBundle().templates.DECLINE_SOFT || {};
  if (rule_id === 'sale_min_mxn') return t.sale_below_minimum_mxn;
  if (rule_id === 'sale_min_usd') return t.sale_below_minimum_usd;
  if (rule_id === 'rent_min_mxn') return t.rent_below_minimum_mxn;
  if (rule_id === 'rent_min_usd') return t.rent_below_minimum_usd;
  if (rule_id === 'zone_out_of_coverage') return t.zone_out_of_coverage;
  return t.default;
}

/**
 * @param {{
 *   policyResult: object,
 *   responsePlan?: object[]|null,
 *   state: object,
 * }} input
 */
function composePolicyCrossReply(input) {
  const policy = input.policyResult || {};
  const templates = loadPolicyBundle().templates;
  const steps = Array.isArray(input.responsePlan) ? input.responsePlan : [];

  const ack = steps.find((s) => s.type === 'acknowledge_dual');
  const qualifyStep = steps.find((s) => s.type === 'qualify');

  if (policy.blockingDecline && policy.hasDualIntent && policy.decision === DECISIONS.ATTEND) {
    const declineLine = templateForDecline(policy.blockingDecline.rule_id);
    const follow =
      qualifyStep?.text ||
      'Sobre la parte de compra, sigo contigo: ¿en qué zona te gustaría buscar y con qué presupuesto aproximado?';
    return `${declineLine} ${follow}`.trim();
  }

  if (policy.decision === DECISIONS.DECLINE_SOFT) {
    return templateForDecline(policy.rule_id);
  }

  if (policy.decision === DECISIONS.HANDOFF) {
    return (
      templates.HANDOFF?.[policy.rule_id === 'zone_ambiguous' ? 'zone_ambiguous' : 'policy_exception'] ||
      templates.HANDOFF?.policy_exception
    );
  }

  if (policy.decision === DECISIONS.QUALIFY || policy.decision === DECISIONS.DEFER) {
    if (ack?.text) return ack.text;
    if (policy.rule_id === 'insufficient_policy_data' || policy.rule_id === 'qualify_slots') {
      return (
        templates.QUALIFY?.missing_amount ||
        'Para orientarte bien, ¿me compartes zona y rango aproximado de la propiedad?'
      );
    }
    return templates.QUALIFY?.missing_zone || templates.QUALIFY?.missing_amount;
  }

  return null;
}

module.exports = {
  composePolicyCrossReply,
  templateForDecline,
};
