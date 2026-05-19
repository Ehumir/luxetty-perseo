'use strict';

const { isRuntimeSafetyEnabled, getFloodWindowMs, getFloodMaxMessages } = require('../../../config/perseoM403Flags');
const { recordMetric } = require('./observability/runtimeMetricsCollector');

/** @type {Map<string, number[]>} */
const inboundTimestamps = new Map();

/** @type {number} */
let queueOverflowCount = 0;

function resetRuntimeSafetyState() {
  inboundTimestamps.clear();
  queueOverflowCount = 0;
}

function checkFloodProtection(conversationId) {
  if (!isRuntimeSafetyEnabled()) return { allowed: true, mode: 'disabled' };
  const key = String(conversationId || 'global');
  const now = Date.now();
  const windowMs = getFloodWindowMs();
  const max = getFloodMaxMessages();
  const arr = (inboundTimestamps.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  inboundTimestamps.set(key, arr);
  if (arr.length > max) {
    recordMetric('flood_block', { conversation_id: key, count: arr.length });
    return {
      allowed: false,
      reason: 'flood_protection',
      count: arr.length,
      max,
    };
  }
  return { allowed: true, count: arr.length };
}

function checkQueueOverflow(pendingCount) {
  if (!isRuntimeSafetyEnabled()) return { overflow: false };
  const max = Number(process.env.PERSEO_CRM_QUEUE_MAX_PENDING || 500);
  if (pendingCount > max) {
    queueOverflowCount += 1;
    return { overflow: true, pending: pendingCount, max };
  }
  return { overflow: false, pending: pendingCount };
}

function checkWorkerStarvation(processed, claimed, batchSize) {
  if (!isRuntimeSafetyEnabled()) return { starved: false };
  if (claimed > 0 && processed === 0) {
    return { starved: true, claimed, processed };
  }
  if (claimed < batchSize * 0.2 && batchSize >= 5) {
    return { starved: true, claimed, batchSize, hint: 'low_throughput' };
  }
  return { starved: false };
}

function beginWebhookTiming() {
  return Date.now();
}

function endWebhookTiming(startMs) {
  const ms = Date.now() - startMs;
  recordMetric('webhook_latency', { ms });
  return ms;
}

module.exports = {
  resetRuntimeSafetyState,
  checkFloodProtection,
  checkQueueOverflow,
  checkWorkerStarvation,
  beginWebhookTiming,
  endWebhookTiming,
};
