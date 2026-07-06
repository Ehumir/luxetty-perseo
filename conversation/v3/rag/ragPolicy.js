'use strict';

const DEFAULT_MIN_SCORE = Number(process.env.RAG_MIN_SCORE || 0.72);
const DEFAULT_AMBIGUITY_GAP = Number(process.env.RAG_AMBIGUITY_GAP || 0.05);

function chunkScore(chunk) {
  return Number(chunk?.similarity ?? chunk?.score ?? 0);
}

/**
 * Valida chunk recuperado: activo, scope permitido, sin PII en metadata.
 */
function isChunkAllowed(chunk) {
  if (!chunk) return false;
  if (chunk.is_active === false) return false;
  const scope = chunk.visibility_scope || 'internal';
  if (scope === 'agent_only') return false;
  const meta = chunk.metadata || {};
  if (meta.phone || meta.email || meta.whatsapp || meta.conversation_id) return false;
  return true;
}

function filterValidChunks(chunks = []) {
  return (Array.isArray(chunks) ? chunks : []).filter(isChunkAllowed);
}

/**
 * Evalúa candidatos post-threshold.
 * @returns {{ confidence: number, ambiguous: boolean, fallback: boolean, top: object|null, runners: object[] }}
 */
function evaluateRetrieval(candidates = [], { minScore = DEFAULT_MIN_SCORE, ambiguityGap = DEFAULT_AMBIGUITY_GAP } = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((c) => chunkScore(c) >= minScore);
  if (!list.length) {
    return { confidence: 0, ambiguous: false, fallback: true, top: null, runners: [] };
  }

  const sorted = [...list].sort((a, b) => chunkScore(b) - chunkScore(a));
  const top = sorted[0];
  const topScore = chunkScore(top);
  const secondScore = sorted[1] ? chunkScore(sorted[1]) : 0;
  const ambiguous = sorted.length > 1 && topScore - secondScore < ambiguityGap;

  let confidence = topScore;
  if (ambiguous) confidence = Math.max(0, topScore - ambiguityGap);

  return {
    confidence,
    ambiguous,
    fallback: topScore < minScore,
    top,
    runners: sorted.slice(1, 4),
  };
}

/**
 * Bloquea claims sin citation/evidencia suficiente.
 */
function canAssertClaim({ confidence, citations = [], minConfidence = DEFAULT_MIN_SCORE } = {}) {
  if (confidence < minConfidence) return false;
  if (!Array.isArray(citations) || citations.length === 0) return false;
  return citations.some((c) => Number(c.score) >= minConfidence);
}

/**
 * Valida propiedad publicable (no oculta / despublicada).
 */
function isPropertyRowPublishable(row) {
  if (!row?.id) return false;
  if (row.archived_at) return false;
  const pub = row.is_public === true || row.visible_on_website === true;
  const status = String(row.status || row.commercial_status || '').toLowerCase();
  if (status === 'archived' || status === 'hidden') return false;
  return pub;
}

module.exports = {
  DEFAULT_MIN_SCORE,
  DEFAULT_AMBIGUITY_GAP,
  chunkScore,
  isChunkAllowed,
  filterValidChunks,
  evaluateRetrieval,
  canAssertClaim,
  isPropertyRowPublishable,
};
