'use strict';

/**
 * Construye ContextPackV1 para PERSEO V3.
 * @see conversation/v3/rag/contextPackV1.schema.json
 */
function buildContextPackV1({
  sources = [],
  citations = [],
  scores = {},
  confidence = 0,
  context_tokens_estimated = 0,
  chunks_selected = 0,
  chunks_dropped = 0,
  fallback_used = false,
  rag_query_log_id = null,
  latency_ms = 0,
} = {}) {
  const pack = {
    context_pack_version: '1',
    sources,
    citations,
    scores: {
      top_score: Number(scores.top_score ?? 0),
      min_score_threshold: Number(scores.min_score_threshold ?? 0.72),
      ...(scores.avg_score != null ? { avg_score: Number(scores.avg_score) } : {}),
    },
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    context_tokens_estimated: Math.max(0, Number(context_tokens_estimated) || 0),
    chunks_selected: Math.max(0, Number(chunks_selected) || 0),
    chunks_dropped: Math.max(0, Number(chunks_dropped) || 0),
    fallback_used: !!fallback_used,
    latency_ms: Math.max(0, Number(latency_ms) || 0),
  };
  if (rag_query_log_id) pack.rag_query_log_id = rag_query_log_id;
  return pack;
}

module.exports = {
  buildContextPackV1,
};
