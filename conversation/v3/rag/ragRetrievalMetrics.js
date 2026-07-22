'use strict';

/**
 * RQ-1 / RQ-3 / RQ-4 — métricas de retrieval (offline + runtime helpers).
 */

function chunkScore(chunk) {
  return Number(chunk?.similarity ?? chunk?.score ?? 0);
}

function chunkId(chunk) {
  return chunk?.chunk_id || chunk?.id || null;
}

/**
 * Rank 1-based of first correct chunk in ranked list; null if absent.
 */
function rankOfCorrect(ranked = [], correctIds) {
  const set =
    correctIds instanceof Set
      ? correctIds
      : new Set(Array.isArray(correctIds) ? correctIds : []);
  if (!set.size) return null;
  for (let i = 0; i < ranked.length; i++) {
    const id = chunkId(ranked[i]);
    if (id && set.has(id)) return i + 1;
  }
  return null;
}

function recallAtK(ranked = [], correctIds, k = 5) {
  const set =
    correctIds instanceof Set
      ? correctIds
      : new Set(Array.isArray(correctIds) ? correctIds : []);
  if (!set.size) return 0;
  const hit = ranked.slice(0, k).some((c) => set.has(chunkId(c)));
  return hit ? 1 : 0;
}

function mrr(ranked = [], correctIds) {
  const rank = rankOfCorrect(ranked, correctIds);
  return rank ? 1 / rank : 0;
}

function ndcgAtK(ranked = [], correctIds, k = 5) {
  const set =
    correctIds instanceof Set
      ? correctIds
      : new Set(Array.isArray(correctIds) ? correctIds : []);
  if (!set.size) return 0;
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) {
    if (set.has(chunkId(ranked[i]))) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  const idealHits = Math.min(set.size, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Simula curva recall@1 / fallback rate vs threshold.
 */
function simulateThresholdCurve(rows = [], thresholds = [0.5, 0.6, 0.72, 0.8]) {
  return thresholds.map((th) => {
    let labeled = 0;
    let recall1 = 0;
    let fallback = 0;
    for (const row of rows) {
      const top20 = row.top20 || [];
      const correct = row.correct_chunk_ids || row.correctIds;
      const kept = top20.filter((c) => chunkScore(c) >= th);
      if (row.has_labeled_relevant || (correct && (correct.size || correct.length))) {
        labeled += 1;
        recall1 += recallAtK(kept, correct, 1);
      }
      if (!kept.length) fallback += 1;
    }
    const n = rows.length || 1;
    return {
      threshold: th,
      recall_at_1: labeled ? recall1 / labeled : 0,
      fallback_rate: fallback / n,
      labeled,
    };
  });
}

function aggregateRecallMetrics(labeledRows = []) {
  const n = labeledRows.length || 1;
  const avg = (fn) => labeledRows.reduce((s, r) => s + fn(r), 0) / n;
  return {
    recall_at_1: avg((r) => r.recall_at_1 ?? recallAtK(r.top20 || [], r.correct_chunk_ids, 1)),
    recall_at_5: avg((r) => r.recall_at_5 ?? recallAtK(r.top20 || [], r.correct_chunk_ids, 5)),
    recall_at_20: avg((r) => r.recall_at_20 ?? recallAtK(r.top20 || [], r.correct_chunk_ids, 20)),
    mrr: avg((r) => r.mrr ?? mrr(r.top20 || [], r.correct_chunk_ids)),
    ndcg_at_5: avg((r) => r.ndcg_at_5 ?? ndcgAtK(r.top20 || [], r.correct_chunk_ids, 5)),
    sample_size: labeledRows.length,
  };
}

function chunkReuseStats(rows = []) {
  const counts = new Map();
  for (const row of rows) {
    for (const c of row.top20 || []) {
      const id = chunkId(c);
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  const reused = [...counts.values()].filter((n) => n > 1).length;
  return {
    unique_chunks: counts.size,
    reused_chunks: reused,
    reuse_rate: counts.size ? reused / counts.size : 0,
  };
}

/** Contadores runtime isolation / wrong-domain (in-memory). */
const runtimeCounters = {
  retrievals: 0,
  wrong_domain: 0,
  isolation_ok: 0,
};

function recordDomainIsolation({ expectedDomain, actualDomain } = {}) {
  runtimeCounters.retrievals += 1;
  if (!expectedDomain || !actualDomain) return;
  if (expectedDomain === actualDomain) runtimeCounters.isolation_ok += 1;
  else runtimeCounters.wrong_domain += 1;
}

function getDomainIsolationSnapshot() {
  return { ...runtimeCounters };
}

function resetDomainIsolationCounters() {
  runtimeCounters.retrievals = 0;
  runtimeCounters.wrong_domain = 0;
  runtimeCounters.isolation_ok = 0;
}

module.exports = {
  chunkScore,
  chunkId,
  rankOfCorrect,
  recallAtK,
  mrr,
  ndcgAtK,
  simulateThresholdCurve,
  aggregateRecallMetrics,
  chunkReuseStats,
  recordDomainIsolation,
  getDomainIsolationSnapshot,
  resetDomainIsolationCounters,
};
