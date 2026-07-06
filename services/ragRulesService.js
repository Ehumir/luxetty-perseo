'use strict';

const { isRagRulesEnabled } = require('../config/accP0Flags');
const ragService = require('./ragService');

const RULES_DOMAINS = [
  'rules_perseo',
  'rules_atena',
  'assignment_rules',
  'commercial_objections',
  'campaigns',
  'zones',
  'scripts',
];

/**
 * Recupera reglas ATENA/PERSEO vía RPC. Solo lectura; sin interpretación de negocio.
 */
async function fetchRulesChunks(db, { query, domain = null, matchCount = 8 }, logger = console) {
  if (!isRagRulesEnabled()) {
    return { chunks: [], fallback: true };
  }

  const rpcParams = {
    match_count: matchCount,
    min_score: Number(process.env.RAG_MIN_SCORE || 0.72),
    filter_source_type: null,
    filter_registry_domain_code: domain || null,
    filter_is_active: true,
  };

  const search = await ragService.semanticSearch(db, {
    query,
    rpcName: 'match_knowledge_chunks',
    rpcParams,
    logger,
  });

  if (search.fallback) return { chunks: [], fallback: true, query_hash: search.query_hash };

  const domainFiltered = domain
    ? search.chunks.filter((c) => c.registry_domain_code === domain)
    : search.chunks.filter((c) => RULES_DOMAINS.includes(c.registry_domain_code));

  return {
    chunks: domainFiltered,
    fallback: false,
    query_hash: search.query_hash,
    latency_ms: search.latency_ms,
  };
}

/**
 * ContextPack de reglas (no modifica pipeline ni respuesta al usuario).
 */
async function fetchRulesContextPack(db, { query, logger = console } = {}) {
  if (!isRagRulesEnabled()) {
    return {
      contextPack: ragService.createContextPack({ fallback_used: true }),
      fallback: true,
    };
  }

  return ragService.retrieveContextPack(db, {
    query,
    rpcName: 'match_knowledge_chunks',
    rpcParams: {
      match_count: 10,
      min_score: Number(process.env.RAG_MIN_SCORE || 0.72),
      filter_source_type: null,
      filter_registry_domain_code: null,
      filter_is_active: true,
    },
    logger,
  });
}

module.exports = {
  RULES_DOMAINS,
  fetchRulesChunks,
  fetchRulesContextPack,
};
