'use strict';

const { getPerseoV3Config, evaluateV3PrimaryGate } = require('./perseoV3Flags');

const V3_PIPELINES = new Set(['v3', 'v3_primary']);

/**
 * Gate de seguridad V1: mutaciones CRM reales solo con EXECUTE ON + allowlist + pipeline V3.
 *
 * @param {{
 *   phone: string,
 *   rawPhone?: string|null,
 *   conversationId?: string|null,
 *   v3PrimaryAllowed?: boolean,
 *   selectedPipeline?: string|null,
 *   argosMode?: boolean,
 * }} input
 */
function shouldAllowCrmExecuteForInbound(input) {
  const cfg = getPerseoV3Config();
  const gate = evaluateV3PrimaryGate({
    phone: input?.phone || '',
    rawPhone: input?.rawPhone ?? null,
    argosMode: input?.argosMode === true,
  });

  const selectedPipeline = String(input?.selectedPipeline || 'legacy').trim().toLowerCase() || 'legacy';
  const v3PrimaryAllowed =
    input?.v3PrimaryAllowed === true || (input?.v3PrimaryAllowed !== false && gate.v3_primary_allowed);

  const base = {
    phone: input?.phone || null,
    conversation_id: input?.conversationId || null,
    allowlist_count: cfg.qaAllowlist.length,
    is_qa_allowed: gate.allowlist_match,
    selected_pipeline: selectedPipeline,
    crm_execute_env: cfg.crmExecute,
    v3_enabled: cfg.enabled,
    v3_primary_allowed: v3PrimaryAllowed,
    allowlist_block_reason: gate.v3_primary_block_reason || null,
  };

  if (!cfg.crmExecute) {
    return {
      ...base,
      crm_execute_allowed: false,
      block_reason: 'crm_execute_disabled',
    };
  }

  if (!cfg.enabled) {
    return {
      ...base,
      crm_execute_allowed: false,
      block_reason: 'v3_disabled',
    };
  }

  if (!gate.allowlist_match && !(input?.argosMode === true && process.env.PERSEO_ARGOS_ENABLED === 'true')) {
    return {
      ...base,
      crm_execute_allowed: false,
      block_reason: 'allowlist_no_match',
    };
  }

  if (!v3PrimaryAllowed) {
    return {
      ...base,
      crm_execute_allowed: false,
      block_reason: 'v3_primary_not_allowed',
    };
  }

  if (!V3_PIPELINES.has(selectedPipeline)) {
    return {
      ...base,
      crm_execute_allowed: false,
      block_reason: 'pipeline_not_v3',
    };
  }

  return {
    ...base,
    crm_execute_allowed: true,
    block_reason: null,
  };
}

/**
 * @param {Function|null|undefined} logEvent
 * @param {ReturnType<typeof shouldAllowCrmExecuteForInbound>} gateResult
 */
function logCrmExecuteGate(logEvent, gateResult) {
  const payload = {
    phone: gateResult.phone,
    conversation_id: gateResult.conversation_id,
    allowlist_count: gateResult.allowlist_count,
    is_qa_allowed: gateResult.is_qa_allowed,
    selected_pipeline: gateResult.selected_pipeline,
    crm_execute_env: gateResult.crm_execute_env,
    crm_execute_allowed: gateResult.crm_execute_allowed,
    block_reason: gateResult.block_reason,
    v3_primary_allowed: gateResult.v3_primary_allowed,
    v3_enabled: gateResult.v3_enabled,
  };
  if (typeof logEvent === 'function') {
    logEvent('crm_execute_gate', payload);
  }
}

module.exports = {
  shouldAllowCrmExecuteForInbound,
  logCrmExecuteGate,
  V3_PIPELINES,
};
