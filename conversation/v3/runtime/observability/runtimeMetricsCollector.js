'use strict';

const { isRuntimeObservabilityEnabled } = require('../../../../config/perseoM403Flags');

/** @type {object} */
const counters = {
  webhook_latency_ms: [],
  worker_latency_ms: [],
  retry_count: 0,
  dlq_count: 0,
  timeout_count: 0,
  loop_score_sum: 0,
  loop_score_n: 0,
  policy_hit_count: 0,
  media_reject_count: 0,
  flood_block_count: 0,
  stuck_conversation_count: 0,
  escalation_count: 0,
};

/** @type {Map<string, object>} */
const queueSnapshots = new Map();

/** @type {object|null} */
let lastWorkerHeartbeat = null;

function resetRuntimeMetrics() {
  counters.webhook_latency_ms.length = 0;
  counters.worker_latency_ms.length = 0;
  counters.retry_count = 0;
  counters.dlq_count = 0;
  counters.timeout_count = 0;
  counters.loop_score_sum = 0;
  counters.loop_score_n = 0;
  counters.policy_hit_count = 0;
  counters.media_reject_count = 0;
  counters.flood_block_count = 0;
  counters.stuck_conversation_count = 0;
  counters.escalation_count = 0;
  queueSnapshots.clear();
  lastWorkerHeartbeat = null;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function recordMetric(eventType, payload = {}) {
  if (!isRuntimeObservabilityEnabled() && !payload.force) return;

  switch (eventType) {
    case 'webhook_latency':
      if (payload.ms != null) counters.webhook_latency_ms.push(Number(payload.ms));
      break;
    case 'worker_latency':
      if (payload.ms != null) counters.worker_latency_ms.push(Number(payload.ms));
      break;
    case 'retry':
      counters.retry_count += Number(payload.count || 1);
      break;
    case 'dlq':
      counters.dlq_count += Number(payload.count || 1);
      break;
    case 'timeout':
      counters.timeout_count += Number(payload.count || 1);
      break;
    case 'loop_score':
      counters.loop_score_sum += Number(payload.score || 0);
      counters.loop_score_n += 1;
      break;
    case 'policy_hit':
      counters.policy_hit_count += 1;
      break;
    case 'media_reject':
      counters.media_reject_count += 1;
      break;
    case 'flood_block':
      counters.flood_block_count += 1;
      break;
    case 'stuck_conversation':
      counters.stuck_conversation_count += 1;
      break;
    case 'escalation':
      counters.escalation_count += 1;
      break;
    case 'worker_heartbeat':
      lastWorkerHeartbeat = {
        worker_id: payload.worker_id,
        at: new Date().toISOString(),
        claimed: payload.claimed,
        processed: payload.processed,
      };
      break;
    case 'queue_snapshot':
      queueSnapshots.set(payload.worker_id || 'default', {
        at: new Date().toISOString(),
        pending: payload.pending,
        processing: payload.processing,
        failed: payload.failed,
        dead_letter: payload.dead_letter,
        frozen: payload.frozen,
      });
      break;
    default:
      break;
  }
}

function buildRuntimeHealthSnapshot() {
  const loopAvg =
    counters.loop_score_n > 0 ? counters.loop_score_sum / counters.loop_score_n : null;
  return {
    at: new Date().toISOString(),
    enabled: isRuntimeObservabilityEnabled(),
    webhook_latency_p95: percentile(counters.webhook_latency_ms, 95),
    worker_latency_p95: percentile(counters.worker_latency_ms, 95),
    retry_count: counters.retry_count,
    dlq_count: counters.dlq_count,
    timeout_rate: counters.timeout_count,
    loop_score_avg: loopAvg,
    policy_hit_count: counters.policy_hit_count,
    media_reject_count: counters.media_reject_count,
    flood_block_count: counters.flood_block_count,
    stuck_conversation_count: counters.stuck_conversation_count,
    escalation_count: counters.escalation_count,
    last_worker_heartbeat: lastWorkerHeartbeat,
    queue_snapshots: Object.fromEntries(queueSnapshots),
  };
}

function getRuntimeMetricsForState() {
  const snap = buildRuntimeHealthSnapshot();
  return {
    runtime_health: snap,
    observability_recorded: isRuntimeObservabilityEnabled(),
  };
}

module.exports = {
  resetRuntimeMetrics,
  recordMetric,
  buildRuntimeHealthSnapshot,
  getRuntimeMetricsForState,
};
