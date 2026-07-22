'use strict';

/**
 * RQ-3 — Orquestador de retrieval con domain routing.
 */

const ragService = require('../../../services/ragService');
const ragRulesService = require('../../../services/ragRulesService');
const { classifyDomainIntent } = require('./domainIntentClassifier');
const { getMinScoreForDomain } = require('./ragDomainThresholdLoader');
const { chunkScore, recordDomainIsolation } = require('./ragRetrievalMetrics');
const { isRagDomainRoutingEnabled, isRagP0Enabled } = require('../../../config/accP0Flags');

const PROPERTY_DOMAIN = 'properties';
const RULES_DOMAINS = new Set([
  'rules_perseo',
  'rules_atena',
  'assignment_rules',
  'commercial_objections',
  'campaigns',
  'zones',
  'scripts',
]);

function filterChunksByDomain(chunks = [], domain) {
  if (!domain) return Array.isArray(chunks) ? chunks : [];
  return (Array.isArray(chunks) ? chunks : []).filter((c) => c.registry_domain_code === domain);
}

/**
 * @returns {Promise<{
 *   search: { chunks: object[], fallback?: boolean },
 *   routing: object,
 *   top1: object|null,
 *   top1_score: number,
 *   thresholded: object[],
 *   fallback: boolean,
 * }>}
 */
async function retrieveWithDomainRouting(
  db,
  { query, domain = undefined, matchCount = 20, logger = console } = {}
) {
  const start = Date.now();
  const intent = classifyDomainIntent(query);
  const domainSelected =
    domain ||
    intent.domain ||
    (isRagDomainRoutingEnabled() ? 'scripts' : null);

  const routing = {
    domain_selected: domainSelected,
    domain_routing_enabled: isRagDomainRoutingEnabled(),
    intent_domain: intent.domain,
    intent_confidence: intent.confidence,
    latency_ms: 0,
  };

  if (!isRagP0Enabled()) {
    routing.latency_ms = Date.now() - start;
    return {
      search: { chunks: [], fallback: true },
      routing,
      top1: null,
      top1_score: 0,
      thresholded: [],
      fallback: true,
    };
  }

  const minScore = getMinScoreForDomain(domainSelected);
  let search;

  if (domainSelected === PROPERTY_DOMAIN) {
    search = await ragService.semanticSearch(db, {
      query: String(query || ''),
      rpcName: 'match_property_chunks',
      rpcParams: {
        match_count: matchCount,
        min_score: ragService.getRagRpcMinScore(),
        filter_visibility_scope: null,
        filter_is_active: true,
        filter_property_id: null,
      },
      logger,
    });
  } else if (RULES_DOMAINS.has(domainSelected)) {
    const rules = await ragRulesService.fetchRulesChunks(
      db,
      { query, domain: domainSelected, matchCount },
      logger
    );
    search = {
      chunks: rules.chunks || [],
      fallback: !!rules.fallback,
      latency_ms: rules.latency_ms,
      query_hash: rules.query_hash,
    };
  } else {
    search = await ragService.semanticSearch(db, {
      query: String(query || ''),
      rpcName: 'match_knowledge_chunks',
      rpcParams: {
        match_count: matchCount,
        min_score: ragService.getRagRpcMinScore(),
        filter_source_type: null,
        filter_visibility_scope: null,
        filter_is_active: true,
        filter_property_id: null,
      },
      logger,
    });
  }

  const filtered = isRagDomainRoutingEnabled()
    ? filterChunksByDomain(search.chunks || [], domainSelected)
    : search.chunks || [];

  const sorted = [...filtered].sort((a, b) => chunkScore(b) - chunkScore(a));
  const thresholded = sorted.filter((c) => chunkScore(c) >= minScore);
  const top1 = thresholded[0] || sorted[0] || null;

  recordDomainIsolation({
    expectedDomain: domainSelected,
    actualDomain: top1?.registry_domain_code || null,
  });

  routing.latency_ms = Date.now() - start;
  routing.min_score = minScore;
  routing.domain_filter_applied = isRagDomainRoutingEnabled();

  return {
    search: { chunks: sorted.length ? sorted : search.chunks || [], fallback: !!search.fallback },
    routing,
    top1,
    top1_score: top1 ? chunkScore(top1) : 0,
    thresholded,
    fallback: !thresholded.length || !!search.fallback,
  };
}

module.exports = {
  retrieveWithDomainRouting,
  filterChunksByDomain,
};
