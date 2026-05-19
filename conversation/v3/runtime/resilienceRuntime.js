'use strict';

const { cleanSpaces } = require('../../../utils/text');
const { isResilienceRuntimeEnabled } = require('../../../config/perseoM401Flags');

function computeAntiLoopScore(state, replyText) {
  const last = cleanSpaces(state?.lastAssistantReply || '');
  const next = cleanSpaces(replyText || '');
  if (!last || !next) return 0;
  if (last === next) return 1;
  if (last.length > 20 && next.includes(last.slice(0, 40))) return 0.85;
  return 0;
}

function detectConfusion(state, text) {
  const flags = [];
  const lower = cleanSpaces(text).toLowerCase();
  if (state?.entityTracker?.name && /no me llamo|no soy/.test(lower)) flags.push('name_conflict');
  if (/no entiendo|confund|confus|no me queda claro|otra vez/.test(lower)) flags.push('user_confused');
  return { confusion_detected: flags.length > 0, flags };
}

function computeEscalationConfidence(state, metrics) {
  let score = 0;
  if (metrics?.anti_loop_score >= 0.85) score += 0.4;
  if (metrics?.confusion_detected) score += 0.35;
  if (state?.frustrationSignals?.count >= 2) score += 0.25;
  return Math.min(1, score);
}

function buildRecoveryPlan(metrics) {
  if (metrics.escalation_confidence >= 0.75) {
    return { action: 'handoff', reason: 'high_escalation' };
  }
  if (metrics.confusion_detected) {
    return { action: 'clarify', reason: 'confusion' };
  }
  if (metrics.anti_loop_score >= 0.85) {
    return { action: 'rephrase', reason: 'anti_loop' };
  }
  return { action: 'continue', reason: 'ok' };
}

function detectContradictions(state) {
  const flags = [];
  const budget = Number(state?.filters?.budget_max);
  const rent = Number(state?.entityTracker?.rent_amount);
  if (budget && rent && rent > budget / 100) flags.push('rent_vs_budget_scale');
  return flags;
}

/**
 * @param {{ state: object, text: string, replyText?: string }} input
 */
function runResilienceRuntime(input) {
  if (!isResilienceRuntimeEnabled()) return null;

  const { state, text, replyText } = input;
  const anti_loop_score = computeAntiLoopScore(state, replyText);
  const confusion = detectConfusion(state, text);
  const contradictions = detectContradictions(state);
  const metrics = {
    anti_loop_score,
    confusion_detected: confusion.confusion_detected,
    confusion_flags: confusion.flags,
    contradiction_flags: contradictions,
  };
  metrics.escalation_confidence = computeEscalationConfidence(state, metrics);
  const recovery_plan = buildRecoveryPlan(metrics);

  return {
    patch: {
      lastResilienceRuntime: metrics,
      recoveryPlan: recovery_plan,
    },
    metrics,
    recovery_plan,
  };
}

module.exports = {
  computeAntiLoopScore,
  detectConfusion,
  computeEscalationConfidence,
  buildRecoveryPlan,
  detectContradictions,
  runResilienceRuntime,
};
