'use strict';

const ragService = require('../../../services/ragService');
const ragRulesService = require('../../../services/ragRulesService');
const ragInventoryService = require('../../../services/ragInventoryService');
const { DEFAULT_MIN_SCORE } = require('./ragPolicy');
const { getMinScoreForDomain } = require('./ragDomainThresholdLoader');
const {
  classifyDomainIntent,
  CONFIDENCE_MED,
  SECONDARY_BY_DOMAIN,
} = require('./domainIntentClassifier');

/**
 * Filtra chunks a dominio(s) permitidos — evita competencia cross-domain.
 * @param {object[]} chunks
 * @param {string|string[]} allowed
 */
function filterChunksByDomain(chunks, allowed) {
  const list = Array.isArray(chunks) ? chunks : [];
  const set = new Set(Array.isArray(allowed) ? allowed : [allowed]);
  return list.filter((c) => set.has(c.registry_domain_code));
}

/**
 * Retrieval especializado por dominio (sin búsqueda global).
 */
async function retrieveForDomain(db, domain, query, { logger = console } = {}) {
  if (domain === 'properties') {
    const retrievalQuery = ragInventoryService.buildInventoryRetrievalQuery(query);
    const search = await ragService.semanticSearch(db, {
      query: retrievalQuery,
      rpcName: 'match_property_chunks',
      rpcParams: {
        match_count: 10,
        min_score: ragService.getRagRpcMinScore(),
        filter_visibility_scope: null,
        filter_is_active: true,
        filter_property_id: null,
      },
      logger,
    });

    if (search.fallback || !search.chunks?.length) {
      return {
        chunks: [],
        candidates: [],
        thresholded: [],
        fallback: true,
        domain,
        rpcName: 'match_property_chunks',
        search,
      };
    }

    const candidates = ragService.selectCandidates(search.chunks, { topK: 5 });
    const minScore = getMinScoreForDomain(domain);
    const thresholded = ragService.applyThresholds(candidates, { minScore });
    return {
      chunks: search.chunks,
      candidates,
      thresholded,
      fallback: !thresholded.length,
      domain,
      rpcName: 'match_property_chunks',
      search,
    };
  }

  const retrievalQuery = ragRulesService.buildRulesRetrievalQuery(query, domain);
  const search = await ragService.semanticSearch(db, {
    query: retrievalQuery,
    rpcName: 'match_knowledge_chunks',
    rpcParams: ragRulesService.buildKnowledgeChunksRpcParams({ matchCount: 10, domain }),
    logger,
  });

  if (search.fallback) {
    return {
      chunks: [],
      candidates: [],
      thresholded: [],
      fallback: true,
      domain,
      rpcName: 'match_knowledge_chunks',
      search,
    };
  }

  const domainChunks = filterChunksByDomain(search.chunks, domain);
  const candidates = ragService.selectCandidates(domainChunks, { topK: 5 });
  const minScore = getMinScoreForDomain(domain);
  const thresholded = ragService.applyThresholds(candidates, { minScore });

  return {
    chunks: domainChunks,
    candidates,
    thresholded,
    fallback: !thresholded.length,
    domain,
    rpcName: 'match_knowledge_chunks',
    search,
    cross_domain_discarded: (search.chunks?.length || 0) - domainChunks.length,
  };
}

/**
 * Domain-Aware Retrieval Orchestrator (RQ-3).
 * @returns {Promise<object>}
 */
async function retrieveWithDomainRouting(db, { query, domain: domainOverride = null, logger = console } = {}) {
  const routingStart = Date.now();
  const intent = domainOverride
    ? { domain: domainOverride, confidence: 1, reason: 'override', secondary_domain: SECONDARY_BY_DOMAIN[domainOverride] }
    : classifyDomainIntent(query);

  const primaryDomain = intent.domain;
  const strategy =
    intent.confidence >= CONFIDENCE_MED ? 'primary_only' : intent.secondary_domain ? 'primary_secondary' : 'primary_only';

  const domainsAttempted = [];
  let primaryResult = await retrieveForDomain(db, primaryDomain, query, { logger });
  domainsAttempted.push(primaryDomain);

  let selectedDomain = primaryDomain;
  let secondaryDomain = null;
  let routingStrategy = strategy;
  let finalResult = primaryResult;

  if (primaryResult.fallback && intent.secondary_domain && strategy === 'primary_secondary') {
    secondaryDomain = intent.secondary_domain;
    const secondaryResult = await retrieveForDomain(db, secondaryDomain, query, { logger });
    domainsAttempted.push(secondaryDomain);
    if (!secondaryResult.fallback && secondaryResult.thresholded.length) {
      finalResult = secondaryResult;
      selectedDomain = secondaryDomain;
      routingStrategy = 'secondary_fallback';
    }
  }

  if (finalResult.fallback) {
    routingStrategy = 'legacy_fallback';
  }

  const ctx = finalResult.fallback ? { chunks: [], dropped: [], context_tokens_estimated: 0, chunks_selected: 0, chunks_dropped: 0 } : ragService.buildContext(finalResult.thresholded);

  const routingMeta = {
    domain_detected: primaryDomain,
    domain_confidence: intent.confidence,
    domain_selected: selectedDomain,
    secondary_domain: secondaryDomain,
    routing_strategy: routingStrategy,
    routing_reason: intent.reason,
    domains_attempted: domainsAttempted,
    chunks_considered: finalResult.chunks?.length ?? 0,
    chunks_selected: ctx.chunks_selected ?? 0,
    cross_domain_discarded: primaryResult.cross_domain_discarded ?? 0,
    routing_latency_ms: Date.now() - routingStart,
    fallback_reason: finalResult.fallback ? 'low_confidence_or_empty' : null,
  };

  return {
    intent,
    routing: routingMeta,
    thresholded: finalResult.thresholded,
    context: ctx,
    fallback: finalResult.fallback,
    top1: finalResult.candidates?.[0] || null,
    top1_score: finalResult.candidates?.[0]
      ? Number(finalResult.candidates[0].similarity ?? finalResult.candidates[0].score ?? 0)
      : 0,
    search: finalResult.search,
  };
}

/**
 * Context pack de reglas con routing domain-aware (prod path RQ-3).
 */
async function fetchDomainAwareRulesContextPack(db, { query, domain = null, logger = console } = {}) {
  const routed = await retrieveWithDomainRouting(db, { query, domain, logger });

  if (routed.fallback || !routed.context?.chunks?.length) {
    return {
      contextPack: ragService.createContextPack({ fallback_used: true, latency_ms: routed.routing.routing_latency_ms }),
      fallback: true,
      routing: routed.routing,
      intent: routed.intent,
    };
  }

  const { evaluateRetrieval } = require('./ragPolicy');
  const minScore = getMinScoreForDomain(routed.routing.domain_selected);
  const evalResult = evaluateRetrieval(routed.thresholded, { minScore });
  const citations = ragService.buildCitationsFromChunks(routed.context.chunks);
  const logId = await ragService.persistRagQueryLog(db, {
    queryHash: routed.search?.query_hash,
    filters: {
      routing_strategy: routed.routing.routing_strategy,
      domain_selected: routed.routing.domain_selected,
      domain_detected: routed.routing.domain_detected,
      min_score_threshold: minScore,
    },
    resultsCount: routed.context.chunks.length,
    latencyMs: (routed.search?.latency_ms || 0) + routed.routing.routing_latency_ms,
    fallbackUsed: false,
    citations,
  });

  const contextPack = ragService.createContextPack({
    chunks: routed.context.chunks,
    confidence: evalResult.confidence,
    minScore,
    fallback_used: false,
    rag_query_log_id: logId,
    latency_ms: routed.routing.routing_latency_ms,
    budgetMeta: routed.context,
  });

  return {
    contextPack,
    fallback: false,
    routing: routed.routing,
    intent: routed.intent,
    evalResult,
  };
}

module.exports = {
  filterChunksByDomain,
  retrieveForDomain,
  retrieveWithDomainRouting,
  fetchDomainAwareRulesContextPack,
};
