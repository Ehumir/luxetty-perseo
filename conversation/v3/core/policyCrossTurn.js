'use strict';

const { isPolicyEngineEnabled, isMessagePlannerEnabled } = require('../../../config/perseoM2Flags');
const { runUnderstandingLayer } = require('../understanding/runUnderstandingLayer');
const { composePolicyCrossReply } = require('../policy/composePolicyReply');
const { DECISIONS } = require('../policy/PolicyEngine');

/**
 * @param {{
 *   state: object,
 *   decision: object,
 *   text: string,
 *   logEvent?: Function,
 * }} input
 */
function runPolicyCrossLayer(input) {
  if (!isPolicyEngineEnabled() && !isMessagePlannerEnabled()) return null;

  const layer = runUnderstandingLayer({
    state: input.state,
    decision: input.decision,
    text: input.text,
  });
  if (!layer) return null;

  const emit = typeof input.logEvent === 'function' ? input.logEvent : () => {};

  emit('segments', {
    phase: 'understanding',
    segments: layer.segments.map((s) => ({
      index: s.index,
      intents: s.intents,
      slots: s.slots,
      text_preview: String(s.text).slice(0, 80),
    })),
  });

  if (layer.responsePlan) {
    emit('response_plan', { phase: 'understanding', plan: layer.responsePlan });
  }

  if (layer.policyResult) {
    emit('policy_decision', {
      phase: 'policy',
      ...layer.policyResult,
    });
  }

  return layer;
}

/**
 * @param {{ layer: object, state: object, text?: string }} input
 */
function shouldShortCircuitPolicy(input) {
  const policy = input.layer?.policyResult;
  if (!policy || !isPolicyEngineEnabled()) return false;
  const text = String(input.text || input.state?.lastUserText || '');
  if (
    policy.decision === DECISIONS.DEFER &&
    /\b(preocupad|urgente|urgencia|estres|estresad|nervios)\b/i.test(text)
  ) {
    return false;
  }
  if (policy.shouldShortCircuit) return true;
  if (policy.decision === DECISIONS.DECLINE_SOFT && !policy.hasDualIntent) return true;
  if (policy.decision === DECISIONS.HANDOFF) return true;
  if (policy.decision === DECISIONS.QUALIFY && policy.rule_id === 'insufficient_policy_data') {
    return true;
  }
  if (policy.decision === DECISIONS.DEFER) return true;
  return false;
}

/**
 * @param {{ layer: object, state: object }} input
 */
function buildPolicyShortCircuitReply(input) {
  const reply = composePolicyCrossReply({
    policyResult: input.layer.policyResult,
    responsePlan: input.layer.responsePlan,
    state: input.state,
  });
  return reply;
}

module.exports = {
  runPolicyCrossLayer,
  shouldShortCircuitPolicy,
  buildPolicyShortCircuitReply,
};
