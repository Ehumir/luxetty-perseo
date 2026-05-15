'use strict';

const { getPerseoV3Config } = require('../../../config/perseoV3Flags');
const { processV3Turn } = require('./v3Runtime');
const { runV3ShadowPass } = require('./shadowRuntime');
const { clearSession } = require('./sessionStore');
const { parseSprint1StrictCommand } = require('../../qaSprint1Commands');

function normalizePhoneForAllowlist(phone) {
  return String(phone || '').replace(/\D/g, '').replace(/^0+/, '');
}

function isPhoneOnV3Allowlist(phone) {
  const cfg = getPerseoV3Config();
  if (!cfg.enabled || !cfg.qaAllowlist.length) return false;
  const digits = normalizePhoneForAllowlist(phone);
  if (!digits) return false;
  return cfg.qaAllowlist.some((entry) => {
    const e = normalizePhoneForAllowlist(entry);
    if (!e) return false;
    return digits === e || digits.endsWith(e) || e.endsWith(digits);
  });
}

/**
 * @returns {'v3_primary'|'legacy_primary'|'disabled'}
 */
function resolveInboundRoutingMode(phone) {
  const cfg = getPerseoV3Config();
  if (!cfg.enabled) return 'legacy_primary';
  if (isPhoneOnV3Allowlist(phone)) return 'v3_primary';
  return 'legacy_primary';
}

/**
 * @param {{ conversationId: string, phone: string, text: string }} input
 */
async function tryV3PrimaryReply(input) {
  const route = resolveInboundRoutingMode(input.phone);
  if (route !== 'v3_primary') {
    return { handled: false, route };
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
    });
    if (!result.ok && result.fallbackToLegacy) {
      return { handled: false, route, fallback: true, reason: 'rule_blocked' };
    }
    if (!result.ok || !result.reply) {
      return { handled: false, route, fallback: true, reason: 'empty_reply' };
    }
    return {
      handled: true,
      route,
      reply: result.reply,
      responseSource: result.responseSource,
      v3State: result.state,
      skipLegacyCrm: true,
    };
  } catch (err) {
    console.error('v3_primary_fatal', err);
    return { handled: false, route, fallback: true, reason: 'exception' };
  }
}

function maybeRunV3Shadow({ conversationId, phone, text, legacyReply }) {
  const cfg = getPerseoV3Config();
  if (!cfg.shadowMode) return null;
  if (resolveInboundRoutingMode(phone) === 'v3_primary') return null;
  return runV3ShadowPass({ conversationId, phone, text, legacyReply });
}

module.exports = {
  resolveInboundRoutingMode,
  isPhoneOnV3Allowlist,
  tryV3PrimaryReply,
  maybeRunV3Shadow,
  clearSession,
};
