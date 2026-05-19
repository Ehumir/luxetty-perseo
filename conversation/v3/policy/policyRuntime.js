'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isPolicyRuntimeEnabled } = require('../../../config/perseoM401Flags');
const { loadPolicyBundle } = require('./policyConfigLoader');

const RUNTIME_POLICY_PATH = path.join(__dirname, '../../../config/policy/runtime-policy.v1.json');

let _runtimeCache = null;

function loadRuntimePolicyOverlay() {
  if (_runtimeCache) return _runtimeCache;
  if (!fs.existsSync(RUNTIME_POLICY_PATH)) {
    _runtimeCache = null;
    return null;
  }
  _runtimeCache = JSON.parse(fs.readFileSync(RUNTIME_POLICY_PATH, 'utf8'));
  return _runtimeCache;
}

function clearRuntimePolicyCache() {
  _runtimeCache = null;
}

function isPhoneAllowlisted(phone, runtime) {
  const list = runtime?.allowlists?.phones || [];
  if (!list.length || !phone) return false;
  return list.includes(String(phone).trim());
}

function matchesTemporaryRule(rule, now = new Date()) {
  if (!rule?.effective_at && !rule?.expires_at) return true;
  const t = now.getTime();
  if (rule.effective_at && t < new Date(rule.effective_at).getTime()) return false;
  if (rule.expires_at && t > new Date(rule.expires_at).getTime()) return false;
  return true;
}

/**
 * Augments base policy context before PolicyEngine.evaluatePolicy.
 * @param {{ phone?: string, language?: string, zone?: string, colonia?: string, amount?: number, campaign_id?: string }} ctx
 */
function applyPolicyRuntimeOverlay(ctx = {}) {
  if (!isPolicyRuntimeEnabled()) {
    return { applied: false, ctx };
  }

  const base = loadPolicyBundle();
  const runtime = loadRuntimePolicyOverlay();
  if (!runtime) {
    return { applied: false, ctx, base_loaded: !!base };
  }

  const out = { ...ctx };
  const notes = [];

  if (ctx.language && Array.isArray(runtime.languages) && runtime.languages.length) {
    if (!runtime.languages.includes(ctx.language)) {
      notes.push({ rule: 'language_not_supported', language: ctx.language });
    }
  }

  if (isPhoneAllowlisted(ctx.phone, runtime)) {
    out.policy_runtime_bypass_soft = true;
    notes.push({ rule: 'allowlist_phone' });
  }

  const activeZones = new Set([
    ...(runtime.active_zones || []),
    ...(base?.zones?.active || []),
  ]);
  if (ctx.zone && activeZones.size && !activeZones.has(ctx.zone)) {
    notes.push({ rule: 'zone_not_active', zone: ctx.zone });
    out.zone_runtime_status = 'inactive';
  }

  const campaigns = (runtime.campaigns || []).filter((c) => c.id === ctx.campaign_id);
  if (campaigns.length) out.active_campaign = campaigns[0];

  const temporals = (runtime.temporary_rules || []).filter((r) => matchesTemporaryRule(r));
  if (temporals.length) out.temporary_rules_active = temporals.map((r) => r.id);

  return {
    applied: true,
    ctx: out,
    runtime_version: runtime.version,
    policy_runtime_notes: notes,
    policy_runtime_rule_id: notes[0]?.rule || null,
  };
}

module.exports = {
  loadRuntimePolicyOverlay,
  clearRuntimePolicyCache,
  applyPolicyRuntimeOverlay,
  isPhoneAllowlisted,
  matchesTemporaryRule,
};
