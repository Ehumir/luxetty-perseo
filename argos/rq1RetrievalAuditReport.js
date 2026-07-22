'use strict';

const {
  aggregateRecallMetrics,
  chunkReuseStats,
  simulateThresholdCurve,
} = require('../conversation/v3/rag/ragRetrievalMetrics');

/**
 * ARGOS — reporte RQ-1 (auditoría retrieval, sin modificar producción).
 */
function buildRq1AuditReport({
  run_id,
  retrieval_audit = [],
  retrieval_rows_full = [],
  chunking_audit = {},
  embedding_audit = {},
  query_audit = {},
  ranking_audit = {},
  threshold_curve = [],
  context_pack_audit = {},
  root_cause = {},
  proposals = [],
} = {}) {
  const labeled = retrieval_rows_full.filter((r) => r.has_labeled_relevant);
  const irMetrics = aggregateRecallMetrics(labeled);
  const reuse = chunkReuseStats(retrieval_rows_full);

  return {
    report_version: 'rq1-1',
    phase: 'RQ-1',
    run_id,
    generated_at: new Date().toISOString(),
    production_modified: false,
    sample: {
      total_queries: retrieval_audit.length,
      labeled_queries: labeled.length,
      domains: [...new Set(retrieval_audit.map((r) => r.domain))],
    },
    retrieval_audit_summary: {
      correct_in_top20_rate: labeled.length
        ? labeled.filter((r) => r.correct_in_top20).length / labeled.length
        : 0,
      correct_in_top10_rate: labeled.length
        ? labeled.filter((r) => r.correct_in_top10).length / labeled.length
        : 0,
      correct_in_top5_rate: labeled.length
        ? labeled.filter((r) => r.correct_in_top5).length / labeled.length
        : 0,
      correct_in_top3_rate: labeled.length
        ? labeled.filter((r) => r.correct_in_top3).length / labeled.length
        : 0,
      correct_in_top1_rate: labeled.length
        ? labeled.filter((r) => r.correct_in_top1).length / labeled.length
        : 0,
      avg_top1_score: retrieval_rows_full.length
        ? retrieval_rows_full.reduce((s, r) => s + (r.top1_score || 0), 0) / retrieval_rows_full.length
        : 0,
      avg_correct_score_when_present: labeled.filter((r) => r.correct_rank).length
        ? labeled.filter((r) => r.correct_rank).reduce((s, r) => s + r.correct_score, 0) /
          labeled.filter((r) => r.correct_rank).length
        : 0,
      rpc_empty_rate: retrieval_rows_full.length
        ? retrieval_rows_full.filter((r) => (r.top20?.length || 0) === 0).length / retrieval_rows_full.length
        : 0,
      production_pipeline_empty_rate: retrieval_rows_full.length
        ? retrieval_rows_full.filter((r) => r.prod_would_fallback).length / retrieval_rows_full.length
        : 0,
    },
    kpis: {
      ...irMetrics,
      chunk_reuse: reuse,
      average_chunk_score: retrieval_rows_full.length
        ? retrieval_rows_full.reduce((s, r) => s + (r.avg_top20_score || 0), 0) / retrieval_rows_full.length
        : 0,
      average_context_utilization: context_pack_audit.average_utilization ?? 0,
    },
    chunking_audit,
    embedding_audit,
    query_audit,
    ranking_audit,
    threshold_curve,
    context_pack_audit,
    root_cause,
    proposals,
    pass: labeled.length >= 50 && root_cause?.primary != null,
  };
}

module.exports = {
  buildRq1AuditReport,
  simulateThresholdCurve,
};
