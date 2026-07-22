'use strict';

/**
 * Self-check runtime RAG premium (flags + módulos cargables).
 */

const {
  isRagP0Enabled,
  isRagInventoryEnabled,
  isRagRulesEnabled,
  isRagDomainRoutingEnabled,
  isRagAdaptiveThresholdEnabled,
  isRagRc11ZoneEntityValidationEnabled,
  isRagRc11TelemetryEnabled,
  isRagRc12CampaignEntityValidationEnabled,
  isRagHybridEnabled,
} = require('../../../config/accP0Flags');

function runRagRuntimeSelfCheck() {
  const modules = [
    'domainIntentClassifier',
    'domainRetrievalOrchestrator',
    'ragRetrievalMetrics',
    'ragDomainThresholdLoader',
    'campaignEntityValidation',
    'zoneEntityValidation',
  ];
  const missing = [];
  for (const name of modules) {
    try {
      require(`./${name}`);
    } catch (err) {
      missing.push({ name, error: String(err?.message || err) });
    }
  }

  const flags = {
    RAG_P0_ENABLED: isRagP0Enabled(),
    RAG_INVENTORY_ENABLED: isRagInventoryEnabled(),
    RAG_RULES_ENABLED: isRagRulesEnabled(),
    RAG_DOMAIN_ROUTING_ENABLED: isRagDomainRoutingEnabled(),
    RAG_ADAPTIVE_THRESHOLD_ENABLED: isRagAdaptiveThresholdEnabled(),
    RAG_RC11_ZONE_ENTITY_VALIDATION_ENABLED: isRagRc11ZoneEntityValidationEnabled(),
    RAG_RC11_TELEMETRY_ENABLED: isRagRc11TelemetryEnabled(),
    RAG_RC12_CAMPAIGN_ENTITY_VALIDATION_ENABLED: isRagRc12CampaignEntityValidationEnabled(),
    RAG_HYBRID_ENABLED: isRagHybridEnabled(),
  };

  const pass = missing.length === 0;
  return {
    pass,
    missing_modules: missing,
    flags,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  runRagRuntimeSelfCheck,
};
