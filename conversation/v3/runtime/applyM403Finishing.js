'use strict';

const { isRuntimeObservabilityEnabled } = require('../../../config/perseoM403Flags');
const {
  recordMetric,
  getRuntimeMetricsForState,
} = require('./observability/runtimeMetricsCollector');

function applyM403RuntimeFinishing(state, { decision, resolvedMedia, input }) {
  let next = state;

  if (decision?.policy_rule_id) {
    recordMetric('policy_hit', { rule_id: decision.policy_rule_id });
  }
  if (next?.lastResilienceRuntime?.anti_loop_score != null) {
    recordMetric('loop_score', { score: next.lastResilienceRuntime.anti_loop_score });
    if (Number(next.lastResilienceRuntime.anti_loop_score) > 0.85) {
      recordMetric('escalation', { reason: 'high_loop_score' });
      next = { ...next, runtimeEscalationTriggered: true };
    }
  }
  if (resolvedMedia?.reject_reason) {
    recordMetric('media_reject', { reason: resolvedMedia.reject_reason });
  }

  const obs = getRuntimeMetricsForState();
  if (isRuntimeObservabilityEnabled() || input?.argosMode) {
    next = {
      ...next,
      runtimeObservabilityRecorded: obs.observability_recorded,
      lastRuntimeHealth: obs.runtime_health,
    };
  }

  return next;
}

module.exports = {
  applyM403RuntimeFinishing,
};
