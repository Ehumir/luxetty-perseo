'use strict';

const {
  getAccRagP0FlagSnapshot,
  isRagRulesEffectiveForUser,
  isRagDomainRoutingEnabled,
} = require('../../../config/accP0Flags');
const ragRulesService = require('../../../services/ragRulesService');
const { canAssertClaim, DEFAULT_MIN_SCORE } = require('./ragPolicy');
const { getMinScoreForDomain } = require('./ragDomainThresholdLoader');
const { buildRagRetrievalKpi } = require('./ragKpi');
const {
  classifyDomainIntent,
  detectRulesDomain,
  CONFIDENCE_LOW,
} = require('./domainIntentClassifier');
const { fetchDomainAwareRulesContextPack } = require('./domainRetrievalOrchestrator');

/** @deprecated use classifyDomainIntent — kept for tests / legacy parity */
const RULES_INTENT_PATTERNS = [
  { domain: 'commercial_objections', re: /\bcomisi[oó]n\b|\bexclusiv|\bvaluaci[oó]n\b|\bcu[aá]nto\s+cobran\b/i },
  { domain: 'rules_perseo', re: /\bpol[ií]tica\b|\bregla\b|\bno\s+invent/i },
  { domain: 'rules_atena', re: /\bsolicitud\b|\blead\b|\bcontacto\b/i },
  { domain: 'assignment_rules', re: /\basignaci[oó]n\b|\bownership\b|\bdue[nñ]o\b/i },
  { domain: 'campaigns', re: /\bcampa[nñ]a\b|\bpauta\b|\bmeta\b/i },
  { domain: 'zones', re: /\bcolonia\b|\bzona\b|\bubicaci[oó]n\b/i },
];

function pickGroundedExcerpt(contextPack, { minConfidence, domain = null } = {}) {
  const threshold = minConfidence ?? getMinScoreForDomain(domain) ?? DEFAULT_MIN_SCORE;
  if (!contextPack || contextPack.fallback_used) return null;
  if (!canAssertClaim({ confidence: contextPack.confidence, citations: contextPack.citations, minConfidence: threshold })) {
    return null;
  }
  const top = contextPack.citations?.[0];
  if (!top?.excerpt) return null;
  return String(top.excerpt).slice(0, 180).trim();
}

/** Sprint 5 legacy path — idéntico a 7766a7b cuando RAG_DOMAIN_ROUTING_ENABLED=false */
async function enrichTurnWithRagContextLegacy(db, { text, phone, conversationId, messageId, saveConversationEvent, flags }) {
  const domain = detectRulesDomain(text);
  if (!domain) {
    return {
      contextPack: null,
      meta: { skipped: true, reason: 'no_rules_intent', flags, allowlist_eligible: true, pipeline: 'legacy_sprint5' },
    };
  }

  const start = Date.now();
  try {
    const rulesResult = await ragRulesService.fetchRulesContextPack(db, {
      query: text,
      domain,
      domainAware: false,
    });
    const contextPack = rulesResult?.contextPack || null;
    const latencyMs = Date.now() - start;
    const meta = {
      skipped: false,
      domain,
      pipeline: 'legacy_sprint5',
      flags,
      allowlist_eligible: true,
      confidence: contextPack?.confidence ?? 0,
      chunks_selected: contextPack?.chunks_selected ?? 0,
      chunks_dropped: contextPack?.chunks_dropped ?? 0,
      citations_count: contextPack?.citations?.length ?? 0,
      fallback_used: contextPack?.fallback_used ?? rulesResult?.fallback ?? true,
      latency_ms: latencyMs,
      rag_query_log_id: contextPack?.rag_query_log_id || null,
    };

    if (typeof saveConversationEvent === 'function' && conversationId) {
      const kpiPayload = buildRagRetrievalKpi(contextPack, {
        domain,
        message_id: messageId || null,
        retrieval_latency_ms: latencyMs,
        flags,
        allowlist_eligible: true,
        pipeline: 'legacy_sprint5',
        fallback_reason: meta.fallback_used ? 'low_confidence_or_empty' : null,
      });
      await saveConversationEvent(conversationId, 'rag_retrieval', kpiPayload);
    }

    return { contextPack, meta };
  } catch (err) {
    return {
      contextPack: null,
      meta: {
        skipped: false,
        domain,
        pipeline: 'legacy_sprint5',
        flags,
        allowlist_eligible: true,
        fallback_used: true,
        fallback_reason: 'exception',
        latency_ms: Date.now() - start,
      },
    };
  }
}

/** RQ-3 certified path — domain routing + RQ-4 adaptive threshold via orchestrator */
async function enrichTurnWithRagContextRq3(db, { text, phone, conversationId, messageId, saveConversationEvent, flags, logger }) {
  const intent = classifyDomainIntent(text);

  if (intent.confidence < CONFIDENCE_LOW && intent.domain !== 'properties' && !detectRulesDomain(text)) {
    return {
      contextPack: null,
      meta: {
        skipped: true,
        reason: 'no_rules_intent',
        flags,
        allowlist_eligible: true,
        domain_intent: intent,
        pipeline: 'rq3_domain_routing',
      },
    };
  }

  const domain =
    intent.domain === 'properties'
      ? 'properties'
      : intent.domain === 'scripts'
        ? detectRulesDomain(text) || intent.secondary_domain
        : intent.domain;

  if (!domain || (domain === 'scripts' && !detectRulesDomain(text))) {
    return {
      contextPack: null,
      meta: {
        skipped: true,
        reason: 'no_rules_intent',
        flags,
        allowlist_eligible: true,
        domain_intent: intent,
        pipeline: 'rq3_domain_routing',
      },
    };
  }

  const start = Date.now();
  const minScoreApplied = getMinScoreForDomain(domain);
  try {
    const rulesResult = await fetchDomainAwareRulesContextPack(db, { query: text, domain, logger });
    const contextPack = rulesResult?.contextPack || null;
    const latencyMs = Date.now() - start;
    const routing = rulesResult?.routing || {};
    const meta = {
      skipped: false,
      domain,
      pipeline: 'rq3_domain_routing',
      domain_intent: rulesResult?.intent || intent,
      routing,
      flags,
      allowlist_eligible: true,
      confidence: contextPack?.confidence ?? 0,
      chunks_selected: contextPack?.chunks_selected ?? 0,
      chunks_dropped: contextPack?.chunks_dropped ?? 0,
      citations_count: contextPack?.citations?.length ?? 0,
      fallback_used: contextPack?.fallback_used ?? rulesResult?.fallback ?? true,
      latency_ms: latencyMs,
      rag_query_log_id: contextPack?.rag_query_log_id || null,
    };

    if (typeof saveConversationEvent === 'function' && conversationId) {
      const kpiPayload = buildRagRetrievalKpi(contextPack, {
        domain,
        message_id: messageId || null,
        retrieval_latency_ms: latencyMs,
        flags,
        allowlist_eligible: true,
        pipeline: 'rq3_domain_routing',
        fallback_reason: meta.fallback_used ? routing.fallback_reason || 'low_confidence_or_empty' : null,
        domain_detected: routing.domain_detected,
        domain_confidence: routing.domain_confidence,
        domain_selected: routing.domain_selected,
        secondary_domain: routing.secondary_domain,
        routing_strategy: routing.routing_strategy,
        routing_reason: routing.routing_reason,
        chunks_considered: routing.chunks_considered,
        routing_latency_ms: routing.routing_latency_ms,
        cross_domain_discarded: routing.cross_domain_discarded,
        secondary_domain_discarded: routing.secondary_domain_discarded,
        secondary_domain_used: routing.secondary_domain_used,
        wrong_domain_retrieval: routing.wrong_domain_retrieval === true,
        min_score_threshold: minScoreApplied,
      });
      await saveConversationEvent(conversationId, 'rag_retrieval', kpiPayload);
    }

    return { contextPack, meta };
  } catch (err) {
    logger?.warn?.('rag_turn_orchestrator_failed', { error: String(err?.message || err) });
    const meta = {
      skipped: false,
      domain,
      pipeline: 'rq3_domain_routing',
      flags,
      allowlist_eligible: true,
      fallback_used: true,
      fallback_reason: 'exception',
      latency_ms: Date.now() - start,
    };
    if (typeof saveConversationEvent === 'function' && conversationId) {
      const kpiPayload = buildRagRetrievalKpi(null, {
        domain,
        message_id: messageId || null,
        fallback_used: true,
        fallback_reason: 'exception',
        flags,
        allowlist_eligible: true,
        pipeline: 'rq3_domain_routing',
        retrieval_latency_ms: meta.latency_ms,
        min_score_threshold: minScoreApplied,
      });
      await saveConversationEvent(conversationId, 'rag_retrieval', kpiPayload);
    }
    return { contextPack: null, meta };
  }
}

async function enrichTurnWithRagContext(
  db,
  {
    text,
    phone,
    conversationId = null,
    messageId = null,
    saveConversationEvent = null,
    logger = console,
  } = {}
) {
  const flags = getAccRagP0FlagSnapshot();
  const allowlistEligible = isRagRulesEffectiveForUser(phone);

  if (!allowlistEligible) {
    return {
      contextPack: null,
      meta: {
        skipped: true,
        reason: 'not_eligible',
        flags,
        allowlist_eligible: false,
      },
    };
  }

  const ctx = { text, phone, conversationId, messageId, saveConversationEvent, flags, logger };
  if (isRagDomainRoutingEnabled()) {
    return enrichTurnWithRagContextRq3(db, ctx);
  }
  return enrichTurnWithRagContextLegacy(db, ctx);
}

module.exports = {
  RULES_INTENT_PATTERNS,
  detectRulesDomain,
  pickGroundedExcerpt,
  enrichTurnWithRagContext,
  enrichTurnWithRagContextLegacy,
  enrichTurnWithRagContextRq3,
};
