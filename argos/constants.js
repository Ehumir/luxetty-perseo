'use strict';

const ARGOS_BLOCKED_TABLES = new Set([
  'contacts',
  'leads',
  'conversations',
  'conversation_messages',
  'conversation_events',
  'notifications',
  'notification_deliveries',
  'notification_queue',
  'opportunities',
  'opportunity_matches',
  'assignment_logs',
  'agent_assignments',
  'requests',
]);

const ARGOS_BLOCKED_RPC_PREFIXES = [
  'assign_request',
  'resolve_assignment_for_request',
  'create_request',
];

const ARGOS_MAX_TURNS_PER_SCENARIO = Number(process.env.ARGOS_MAX_TURNS_PER_SCENARIO || 30);
const ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE = Number(
  process.env.ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE || 8,
);
const ARGOS_MAX_RECURSIVE_RETRIES = Number(process.env.ARGOS_MAX_RECURSIVE_RETRIES || 3);
const ARGOS_SCENARIO_TIMEOUT_MS = Number(process.env.ARGOS_SCENARIO_TIMEOUT_MS || 120000);
const ARGOS_TURN_TIMEOUT_MS = Number(process.env.ARGOS_TURN_TIMEOUT_MS || 30000);
const ARGOS_TRACE_RING_MAX = Number(process.env.ARGOS_TRACE_RING_MAX || 500);

module.exports = {
  ARGOS_BLOCKED_TABLES,
  ARGOS_BLOCKED_RPC_PREFIXES,
  ARGOS_MAX_TURNS_PER_SCENARIO,
  ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE,
  ARGOS_MAX_RECURSIVE_RETRIES,
  ARGOS_SCENARIO_TIMEOUT_MS,
  ARGOS_TURN_TIMEOUT_MS,
  ARGOS_TRACE_RING_MAX,
  ARGOS_ERROR_CODES: {
    UNAUTHORIZED: 'argos_unauthorized',
    DISABLED: 'argos_disabled',
    SESSION_NOT_FOUND: 'session_not_found',
    LOOP_DETECTED: 'LOOP_DETECTED',
    SCENARIO_TIMEOUT: 'SCENARIO_TIMEOUT',
    TURN_TIMEOUT: 'TURN_TIMEOUT',
    WHATSAPP_BLOCKED: 'ARGOS_WHATSAPP_BLOCKED',
    SIDE_EFFECT_BLOCKED: 'ARGOS_SIDE_EFFECT_BLOCKED',
  },
};
