'use strict';

const { isRagInventoryEffectiveForUser } = require('../config/accP0Flags');
const ragService = require('./ragService');
const {
  DEFAULT_MIN_SCORE,
  evaluateRetrieval,
  filterValidChunks,
  isPropertyRowPublishable,
  chunkScore,
} = require('../conversation/v3/rag/ragPolicy');
const { extractPropertyCode } = require('../conversation/propertyIntentResolver');
const {
  findPropertyByCode,
} = require('./propertyInventoryService');

const RAG_TIMEOUT_MS = Number(process.env.RAG_TIMEOUT_MS || 1200);

function cleanSpaces(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function extractListingIdFromChunk(chunk) {
  const meta = chunk?.metadata || {};
  if (meta.listing_id) return cleanSpaces(meta.listing_id);
  const m = String(chunk?.content || '').match(/LUX:\s*(LUX-[A-Z0-9-]+)/i);
  return m?.[1] ? cleanSpaces(m[1]) : null;
}

function extractPropertyIdFromChunk(chunk) {
  const meta = chunk?.metadata || {};
  return meta.property_id || meta.source_property_id || null;
}

async function loadPropertyFromChunk(db, chunk, logger) {
  const propertyId = extractPropertyIdFromChunk(chunk);
  if (propertyId) {
    const byId = await findPropertyByCode(db, propertyId, logger);
    if (byId?.property) return byId;
  }
  const listingId = extractListingIdFromChunk(chunk);
  if (listingId) {
    return findPropertyByCode(db, listingId, logger);
  }
  return { property: null, propertyId: null, normalized: null };
}

function wrapFoundResult(found, { matchMethod = 'rag_semantic', ragMeta = null } = {}) {
  return {
    status: 'found',
    property: found.property,
    propertyId: found.propertyId,
    normalized: found.normalized,
    match_method: matchMethod,
    rag_meta: ragMeta,
  };
}

function wrapAmbiguousResult(candidates, { ragMeta = null } = {}) {
  return {
    status: 'ambiguous',
    candidates: candidates.map((c) => ({
      listing_id: extractListingIdFromChunk(c) || c.metadata?.listing_id || null,
      property_id: extractPropertyIdFromChunk(c) || null,
      score: chunkScore(c),
      excerpt: String(c.content || '').slice(0, 120),
    })),
    match_method: 'rag_semantic',
    rag_meta: ragMeta,
  };
}

/**
 * Resolución de inventario vía Knowledge Store (solo cuando RAG_INVENTORY_ENABLED).
 * Nunca escribe CRM. Fallback → { status: 'fallback_legacy' }.
 */
async function resolveInboundPropertyReference(db, { text, hintZone, canaryPhone }, logger = console) {
  if (!isRagInventoryEffectiveForUser(canaryPhone)) {
    return { status: 'fallback_legacy' };
  }

  const looseText = cleanSpaces(text);
  if (!looseText) return { status: 'fallback_legacy' };

  // Código directo: no alterar path — delegar a legacy
  if (extractPropertyCode(looseText)) {
    return { status: 'fallback_legacy' };
  }

  const start = Date.now();
  const minScore = DEFAULT_MIN_SCORE;

  try {
    const search = await ragService.semanticSearch(db, {
      query: looseText,
      rpcName: 'match_property_chunks',
      rpcParams: {
        match_count: 5,
        min_score: minScore,
        filter_visibility_scope: null,
        filter_is_active: true,
        filter_property_id: null,
      },
      logger,
    });

    if (Date.now() - start > RAG_TIMEOUT_MS || search.fallback) {
      return { status: 'fallback_legacy', reason: 'timeout_or_rpc_fail' };
    }

    const valid = filterValidChunks(search.chunks);
    const candidates = ragService.selectCandidates(valid, { topK: 5 });
    const thresholded = ragService.applyThresholds(candidates, { minScore });
    const evalResult = evaluateRetrieval(thresholded, { minScore });

    const ragMeta = {
      query_hash: search.query_hash,
      latency_ms: search.latency_ms,
      confidence: evalResult.confidence,
      cache_hit: search.cache_hit,
    };

    if (evalResult.fallback) {
      return { status: 'fallback_legacy', rag_meta: ragMeta, reason: 'low_score' };
    }

    if (evalResult.ambiguous) {
      const publishable = [];
      for (const c of thresholded.slice(0, 3)) {
        const loaded = await loadPropertyFromChunk(db, c, logger);
        if (loaded?.property && isPropertyRowPublishable(loaded.property)) {
          publishable.push(c);
        }
      }
      if (publishable.length >= 2) {
        return wrapAmbiguousResult(publishable, { ragMeta });
      }
    }

    const loaded = await loadPropertyFromChunk(db, evalResult.top, logger);
    if (!loaded?.property || !isPropertyRowPublishable(loaded.property)) {
      return { status: 'fallback_legacy', rag_meta: ragMeta, reason: 'hidden_or_inactive' };
    }

    await ragService.persistRagQueryLog(db, {
      queryHash: search.query_hash,
      filters: {
        source: 'inventory',
        hint_zone: hintZone || null,
        domain: 'properties',
        conversation_id: null,
      },
      resultsCount: 1,
      latencyMs: search.latency_ms,
      fallbackUsed: false,
      citations: ragService.buildCitationsFromChunks([evalResult.top]),
    });

    return wrapFoundResult(loaded, { matchMethod: 'rag_semantic', ragMeta });
  } catch (err) {
    logger.warn?.('rag_inventory_resolve_failed', { error: String(err?.message || err) });
    return { status: 'fallback_legacy', reason: 'exception' };
  }
}

module.exports = {
  resolveInboundPropertyReference,
  extractListingIdFromChunk,
  loadPropertyFromChunk,
};
