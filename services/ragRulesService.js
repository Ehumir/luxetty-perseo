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

const RULES_RETRIEVAL_HINTS = {
  commercial_objections: {
    comisi: 'Objeción comisión\nLa comisión se explica con transparencia según política vigente',
    exclusiv: 'Objeción exclusiva\nLa exclusiva se presenta como beneficio de posicionamiento',
    valuaci: 'Objeción valuación\nLa valuación se basa en comparables de mercado',
  },
  assignment_rules: 'asignación ownership dueño contacto',
  campaigns: 'campaña pauta meta',
  zones: 'zona colonia ubicación',
  rules_perseo: 'política reglas PERSEO no inventar',
  rules_atena: 'solicitud lead contacto ATENA',
  scripts: 'script comercial conversación',
};

function cleanSpaces(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Parámetros alineados con match_knowledge_chunks (migración Sprint 2).
 */
function buildKnowledgeChunksRpcParams({ matchCount = 8, domain = null } = {}) {
  return {
    match_count: matchCount,
    min_score: ragService.getRagRpcMinScore(),
    filter_source_type: null,
    filter_visibility_scope: null,
    filter_is_active: true,
    filter_property_id: null,
  };
}

/**
 * Enriquece query conversacional al formato indexado (sin alterar mensaje al usuario).
 */
function buildRulesRetrievalQuery(text, domain = null) {
  const base = cleanSpaces(text);
  if (!base) return base;

  const hints = RULES_RETRIEVAL_HINTS[domain];
  if (!hints) return base;

  if (typeof hints === 'string') {
    return `${hints}\n${base}`;
  }

  const lower = base.toLowerCase();
  for (const [key, hint] of Object.entries(hints)) {
    if (lower.includes(key)) {
      return `${hint}\n${base}`;
    }
  }

  return base;
}

/**
 * Recupera reglas ATENA/PERSEO vía RPC. Solo lectura; sin interpretación de negocio.
 */
async function fetchRulesChunks(db, { query, domain = null, matchCount = 8 }, logger = console) {
  if (!isRagRulesEnabled()) {
    return { chunks: [], fallback: true };
  }

  const retrievalQuery = buildRulesRetrievalQuery(query, domain);
  const search = await ragService.semanticSearch(db, {
    query: retrievalQuery,
    rpcName: 'match_knowledge_chunks',
    rpcParams: buildKnowledgeChunksRpcParams({ matchCount, domain }),
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
async function fetchRulesContextPack(db, { query, domain = null, logger = console } = {}) {
  if (!isRagRulesEnabled()) {
    return {
      contextPack: ragService.createContextPack({ fallback_used: true }),
      fallback: true,
    };
  }

  const retrievalQuery = buildRulesRetrievalQuery(query, domain);

  return ragService.retrieveContextPack(db, {
    query: retrievalQuery,
    rpcName: 'match_knowledge_chunks',
    rpcParams: buildKnowledgeChunksRpcParams({ matchCount: 10, domain }),
    logger,
  });
}

module.exports = {
  RULES_DOMAINS,
  buildKnowledgeChunksRpcParams,
  buildRulesRetrievalQuery,
  fetchRulesChunks,
  fetchRulesContextPack,
};
