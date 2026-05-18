'use strict';

const {
  getPerseoV3Config,
  evaluateV3PrimaryGate,
  resolveInboundRoutingMode,
} = require('../../../config/perseoV3Flags');
const { processV3Turn } = require('./v3Runtime');
const { buildForcedHandoffFromSession } = require('./forcedHandoffTurn');
const { runV3ShadowPass } = require('./shadowRuntime');
const { clearSession } = require('./sessionStore');
const { parseSprint1StrictCommand } = require('../../qaSprint1Commands');
const { v3Log } = require('./v3Logger');

/**
 * @param {{
 *   conversationId: string,
 *   phone: string,
 *   rawPhone?: string,
 *   text: string,
 *   logEvent?: Function,
 *   campaignHeadline?: string|null,
 *   legacyHydration?: object|null,
 * }} input
 */
function tryV3PrimaryReply(input) {
  const gate = evaluateV3PrimaryGate({
    phone: input.phone,
    rawPhone: input.rawPhone,
    argosMode: input.argosMode === true,
  });

  v3Log('v3_primary_gate', {
    conversation_id: input.conversationId,
    allowlist_match: gate.allowlist_match,
    v3_primary_allowed: gate.v3_primary_allowed,
    v3_primary_block_reason: gate.v3_primary_block_reason,
    inbound_normalized: gate.inbound_normalized,
    allowlist_matched_entry: gate.allowlist_matched_entry || null,
  });

  if (typeof input.logEvent === 'function') {
    input.logEvent('v3_primary_gate', {
      conversation_id: input.conversationId,
      ...gate,
    });
  }

  if (!gate.v3_primary_allowed || gate.route !== 'v3_primary') {
    return {
      handled: false,
      route: gate.route,
      gate,
      blockReason: gate.v3_primary_block_reason,
    };
  }

  const cmd = parseSprint1StrictCommand(input.text);
  if (cmd === 'reset') {
    clearSession(input.conversationId);
  }

  try {
    const result = processV3Turn({
      conversationId: input.conversationId,
      phone: input.phone,
      text: input.text,
      reset: cmd === 'reset',
      campaignHeadline: input.campaignHeadline ?? null,
      legacyHydration: input.legacyHydration ?? null,
    });
    if (!result.ok && result.fallbackToLegacy) {
      const forced = buildForcedHandoffFromSession({
        conversationId: input.conversationId,
        phone: input.phone,
        reason: 'rule_guard_violation',
        legacyHydration: input.legacyHydration ?? null,
      });
      return {
        handled: true,
        route: 'v3_primary',
        gate,
        reply: forced.replyText,
        responseSource: forced.responseSource,
        v3State: forced.state,
        skipLegacyCrm: true,
        forcedHandoffReason: 'rule_guard_violation',
      };
    }
    if (!result.ok || !result.reply) {
      const forced = buildForcedHandoffFromSession({
        conversationId: input.conversationId,
        phone: input.phone,
        reason: result.forcedHandoffReason || 'runtime_error',
        legacyHydration: input.legacyHydration ?? null,
      });
      return {
        handled: true,
        route: 'v3_primary',
        gate,
        reply: forced.replyText,
        responseSource: forced.responseSource,
        v3State: forced.state,
        skipLegacyCrm: true,
        forcedHandoffReason: result.forcedHandoffReason || 'runtime_error',
      };
    }
    return {
      handled: true,
      route: 'v3_primary',
      gate,
      reply: result.reply,
      responseSource: result.responseSource || 'v3_core_f2',
      v3State: result.state,
      decision: result.decision || null,
      guard: result.guard || null,
      skipLegacyCrm: true,
    };
  } catch (err) {
    console.error('v3_primary_fatal', err);
    try {
      const forced = buildForcedHandoffFromSession({
        conversationId: input.conversationId,
        phone: input.phone,
        reason: 'runtime_error',
        legacyHydration: input.legacyHydration ?? null,
      });
      return {
        handled: true,
        route: 'v3_primary',
        gate,
        reply: forced.replyText,
        responseSource: forced.responseSource,
        v3State: forced.state,
        skipLegacyCrm: true,
        forcedHandoffReason: 'runtime_error',
      };
    } catch (forcedErr) {
      console.error('v3_forced_handoff_fatal', forcedErr);
      return {
        handled: false,
        route: 'v3_primary',
        gate,
        fallback: true,
        reason: 'exception',
        blockReason: 'v3_turn_exception',
      };
    }
  }
}

function maybeRunV3Shadow({ conversationId, phone, rawPhone, text, legacyReply, logEvent }) {
  const cfg = getPerseoV3Config();
  if (!cfg.shadowMode) return null;

  const gate = evaluateV3PrimaryGate({ phone, rawPhone });
  if (gate.v3_primary_allowed) {
    v3Log('v3_shadow_skipped_primary_allowlist', {
      conversation_id: conversationId,
      inbound_normalized: gate.inbound_normalized,
    });
    return null;
  }

  if (typeof logEvent === 'function') {
    logEvent('v3_shadow_run', {
      conversation_id: conversationId,
      allowlist_match: gate.allowlist_match,
      block_reason: gate.v3_primary_block_reason,
    });
  }

  return runV3ShadowPass({ conversationId, phone, text, legacyReply });
}

module.exports = {
  resolveInboundRoutingMode,
  isPhoneOnV3Allowlist: (phone) => evaluateV3PrimaryGate({ phone }).allowlist_match,
  evaluateV3PrimaryGate,
  tryV3PrimaryReply,
  maybeRunV3Shadow,
  clearSession,
};
