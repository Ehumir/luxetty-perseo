'use strict';

const { isWaTelemetryEnabled } = require('../../../config/perseoM401Flags');
const { isWaTelemetryTableAvailable, isArgosOrDryContext } = require('./runtimeTableProbe');
const { v3Log } = require('../core/v3Logger');

/** @type {object[]} */
const memoryTelemetry = [];

function resetMemoryTelemetry() {
  memoryTelemetry.length = 0;
}

function getMemoryTelemetry() {
  return [...memoryTelemetry];
}

/**
 * Operational WA telemetry — log / memory / DB (only when table available).
 */
function recordOperationalEvent(supabase, event, logEvent, ctx = {}) {
  const row = {
    conversation_id: event.conversation_id || null,
    channel: event.channel || 'whatsapp',
    policy_hit: event.policy_hit || null,
    handoff_quality: event.handoff_quality != null ? Number(event.handoff_quality) : null,
    humanity_score: event.humanity_score != null ? Number(event.humanity_score) : null,
    drop_reason: event.drop_reason || null,
    media_processed: event.media_processed || null,
    crm_execution_result: event.crm_execution_result || null,
    fallback_reason: event.fallback_reason || null,
    metadata: event.metadata || {},
  };

  v3Log('wa_operational', row);
  if (typeof logEvent === 'function') {
    logEvent('wa_operational', row);
  }

  if (!isWaTelemetryEnabled()) {
    return { recorded: false, mode: 'disabled' };
  }

  if (isArgosOrDryContext(ctx)) {
    memoryTelemetry.push({ ...row, at: new Date().toISOString(), mode: 'memory_argos' });
    return { recorded: true, mode: 'memory_argos' };
  }

  if (supabase?.from && !isArgosOrDryContext(ctx)) {
    void isWaTelemetryTableAvailable(supabase, ctx).then((dbOk) => {
      if (!dbOk) return;
      supabase
        .from('wa_operational_telemetry')
        .insert(row)
        .then(({ error }) => {
          if (error) v3Log('wa_operational_insert_failed', { error: error.message });
        })
        .catch((err) => v3Log('wa_operational_insert_failed', { error: String(err?.message || err) }));
    });
    return { recorded: true, mode: 'db_async' };
  }

  memoryTelemetry.push({ ...row, at: new Date().toISOString(), mode: 'memory' });
  return { recorded: true, mode: 'memory' };
}

function buildTelemetryFromTurn({ state, decision, mediaResult, crmResult }) {
  const antiLoop = state?.lastResilienceRuntime?.anti_loop_score;
  return {
    conversation_id: state?.conversationId,
    channel: 'whatsapp',
    policy_hit: decision?.policy_rule_id || state?.lastPolicyRuleId || null,
    handoff_quality: state?.handoffQuality ?? null,
    humanity_score:
      state?.lastHumanityScore ??
      (antiLoop != null ? Math.max(0, 1 - Number(antiLoop)) : null),
    drop_reason: state?.dropReason || null,
    media_processed: mediaResult
      ? {
          kind: mediaResult.kind,
          provider: mediaResult.provider,
          confidence: mediaResult.confidence,
        }
      : state?.lastMediaIntake
        ? {
            mode: state.lastMediaIntake.mode,
            provider: state.lastMediaIntake.provider,
          }
        : null,
    crm_execution_result: crmResult
      ? {
          executed: !!crmResult.executed,
          skipped: !!crmResult.skipped,
          reason: crmResult.reason || null,
        }
      : {
          queue_status: state?.crmQueueStatus || null,
          runtime_mode: state?.crmRuntimeMode || null,
        },
    fallback_reason: state?.lastFallbackReason || null,
    metadata: {
      stage: state?.qualificationStage,
      understanding_threads: state?.understanding?.threads?.length || 0,
      recovery_plan: state?.recoveryPlan?.action || null,
    },
  };
}

module.exports = {
  recordOperationalEvent,
  buildTelemetryFromTurn,
  resetMemoryTelemetry,
  getMemoryTelemetry,
};
