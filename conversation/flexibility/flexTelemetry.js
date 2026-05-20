'use strict';

const { isConversationalFlexEnabled } = require('../../config/perseoM405Flags');

/** @type {Record<string, number>} */
const counters = {};

/**
 * @param {'money'|'zone'|'consent'|'occupancy'|'short_ack'} kind
 * @param {Record<string, unknown>} [meta]
 */
function recordFlexApplied(kind, meta = {}) {
  if (!isConversationalFlexEnabled()) return;
  counters[kind] = (counters[kind] || 0) + 1;
  if (process.env.PERSEO_FLEX_TELEMETRY === 'true') {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ event: 'perseo_flex_applied', kind, ...meta }));
  }
}

function getFlexTelemetryCounters() {
  return { ...counters };
}

function resetFlexTelemetryCounters() {
  for (const key of Object.keys(counters)) delete counters[key];
}

module.exports = {
  recordFlexApplied,
  getFlexTelemetryCounters,
  resetFlexTelemetryCounters,
};
