'use strict';

const os = require('os');
const { getPerseoV3Config } = require('../../../config/perseoV3Flags');

function extractSupabaseProjectRef() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const m = url.match(/https?:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

/**
 * Identificador de deploy para auditar qué proceso atendió el webhook (Railway/local).
 */
function buildDeploymentHint() {
  const parts = [];
  if (process.env.RAILWAY_PROJECT_NAME) parts.push(`project:${process.env.RAILWAY_PROJECT_NAME}`);
  if (process.env.RAILWAY_ENVIRONMENT_NAME) parts.push(`env:${process.env.RAILWAY_ENVIRONMENT_NAME}`);
  if (process.env.RAILWAY_SERVICE_NAME) parts.push(`service:${process.env.RAILWAY_SERVICE_NAME}`);
  if (process.env.RAILWAY_GIT_BRANCH) parts.push(`branch:${process.env.RAILWAY_GIT_BRANCH}`);
  if (process.env.RAILWAY_GIT_COMMIT_SHA) {
    parts.push(`sha:${String(process.env.RAILWAY_GIT_COMMIT_SHA).slice(0, 12)}`);
  }
  if (process.env.PERSEO_ENV) parts.push(`perseo_env:${process.env.PERSEO_ENV}`);
  if (process.env.PERSEO_BASE_URL_STAGING) {
    parts.push(`base_staging:${process.env.PERSEO_BASE_URL_STAGING}`);
  }
  const ref = extractSupabaseProjectRef();
  if (ref) parts.push(`supabase_ref:${ref}`);
  return parts.length ? parts.join('|') : 'local_or_unknown';
}

/**
 * @param {{
 *   gate: ReturnType<import('../../../config/perseoV3Flags').evaluateV3PrimaryGate>,
 *   handled: boolean,
 *   resultExtras?: {
 *     blockReason?: string|null,
 *     responseSource?: string|null,
 *     forcedHandoffReason?: string|null,
 *     fallback?: boolean,
 *     reason?: string|null,
 *   },
 * }} input
 */
function buildV3PrimaryGatePayload({ gate, handled, resultExtras = {} }) {
  const cfg = getPerseoV3Config();
  const blockReason =
    resultExtras.blockReason ??
    (resultExtras.fallback ? resultExtras.reason || 'v3_turn_exception' : null) ??
    gate.v3_primary_block_reason ??
    null;
  const gateAllowed = gate.v3_primary_allowed === true && gate.route === 'v3_primary';
  const v3Handled = handled === true;
  const selectedPipeline = v3Handled && gateAllowed ? 'v3' : 'legacy';

  return {
    event: 'v3_primary_gate',
    normalized_from: gate.inbound_normalized ?? null,
    inbound_raw: gate.inbound_raw ?? null,
    perseo_v3_enabled: cfg.enabled,
    allowlist_count: cfg.qaAllowlist.length,
    is_qa_allowed: gate.allowlist_match === true,
    block_reason: blockReason,
    selected_pipeline: selectedPipeline,
    handled: v3Handled,
    route: gate.route ?? null,
    v3_primary_allowed: gate.v3_primary_allowed === true,
    v3_primary_bypass_reason: gate.v3_primary_bypass_reason ?? null,
    response_source: resultExtras.responseSource ?? null,
    forced_handoff_reason: resultExtras.forcedHandoffReason ?? null,
    fallback: resultExtras.fallback === true,
    deployment_hint: buildDeploymentHint(),
    hostname: os.hostname(),
    railway_service: process.env.RAILWAY_SERVICE_NAME || process.env.RAILWAY_SERVICE_ID || null,
    railway_environment: process.env.RAILWAY_ENVIRONMENT_NAME || null,
    railway_replica: process.env.RAILWAY_REPLICA_ID || null,
    supabase_project_ref: extractSupabaseProjectRef(),
  };
}

/**
 * @param {{
 *   conversationId: string,
 *   logEvent?: Function,
 *   saveConversationEvent?: (conversationId: string, type: string, payload: object) => Promise<void>|void,
 *   supabase?: import('@supabase/supabase-js').SupabaseClient|null,
 * }} input
 * @param {ReturnType<import('../../../config/perseoV3Flags').evaluateV3PrimaryGate>} gate
 * @param {boolean} handled
 * @param {object} [resultExtras]
 */
async function persistV3PrimaryGateEvent(input, gate, handled, resultExtras = {}) {
  const conversationId = String(input?.conversationId || '').trim();
  if (!conversationId) return;

  const payload = buildV3PrimaryGatePayload({ gate, handled, resultExtras });

  if (typeof input.logEvent === 'function') {
    input.logEvent('v3_primary_gate', {
      conversation_id: conversationId,
      ...payload,
    });
  }

  try {
    if (typeof input.saveConversationEvent === 'function') {
      await input.saveConversationEvent(conversationId, 'v3_primary_gate', payload);
      return;
    }
    if (input.supabase) {
      const { error } = await input.supabase.from('conversation_events').insert({
        conversation_id: conversationId,
        type: 'v3_primary_gate',
        payload,
      });
      if (error) console.error('v3_primary_gate_persist_error', error);
    }
  } catch (err) {
    console.error('v3_primary_gate_persist_fatal', err);
  }
}

module.exports = {
  buildDeploymentHint,
  buildV3PrimaryGatePayload,
  persistV3PrimaryGateEvent,
  extractSupabaseProjectRef,
};
