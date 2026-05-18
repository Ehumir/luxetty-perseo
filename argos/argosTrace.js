'use strict';

const { ARGOS_TRACE_RING_MAX } = require('./constants');

/**
 * @returns {{ events: object[], debug_trace: object[], _ring: object[] }}
 */
function createArgosTrace() {
  return { events: [], debug_trace: [], _ring: [] };
}

function pushRing(trace, entry) {
  trace._ring.push(entry);
  if (trace._ring.length > ARGOS_TRACE_RING_MAX) {
    trace._ring.shift();
  }
}

/**
 * @param {ReturnType<typeof createArgosTrace>} trace
 * @param {{ type: string, phase?: string, payload?: object, visibility?: 'event'|'debug'|'both' }} input
 */
function traceEvent(trace, input) {
  const at = new Date().toISOString();
  const row = {
    at,
    type: input.type,
    phase: input.phase || 'general',
    source: input.source || null,
    payload: input.payload || {},
  };
  const visibility = input.visibility || 'both';
  if (visibility === 'event' || visibility === 'both') {
    trace.events.push({ at, type: input.type, ...input.payload });
  }
  if (visibility === 'debug' || visibility === 'both') {
    trace.debug_trace.push(row);
  }
  pushRing(trace, row);
}

function flushTrace(trace) {
  return {
    events: trace.events,
    debug_trace: trace.debug_trace,
  };
}

module.exports = {
  createArgosTrace,
  traceEvent,
  flushTrace,
};
