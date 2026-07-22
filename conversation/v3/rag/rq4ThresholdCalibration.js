'use strict';

/**
 * RQ-4 — Calibración adaptativa de threshold por dominio (offline/simulación).
 */

const { chunkScore, rankOfCorrect, recallAtK, mrr, ndcgAtK } = require('./ragRetrievalMetrics');

const DEFAULT_THRESHOLDS = [
  0.45, 0.5, 0.55, 0.6, 0.62, 0.64, 0.66, 0.68, 0.7, 0.72, 0.74, 0.76, 0.78, 0.8,
];

const OFFICIAL_DOMAINS = [
  'properties',
  'commercial_objections',
  'assignment_rules',
  'rules_atena',
  'rules_perseo',
  'zones',
  'campaigns',
  'scripts',
];

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function scoreDistribution(scores = []) {
  const vals = scores.filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
  const n = vals.length;
  if (!n) {
    return {
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
      stddev: 0,
      percentiles: { p5: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0 },
    };
  }
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return {
    count: n,
    min: vals[0],
    max: vals[n - 1],
    mean: Number(mean.toFixed(4)),
    median: Number(percentile(vals, 0.5).toFixed(4)),
    stddev: Number(Math.sqrt(variance).toFixed(4)),
    percentiles: {
      p5: Number(percentile(vals, 0.05).toFixed(4)),
      p10: Number(percentile(vals, 0.1).toFixed(4)),
      p25: Number(percentile(vals, 0.25).toFixed(4)),
      p50: Number(percentile(vals, 0.5).toFixed(4)),
      p75: Number(percentile(vals, 0.75).toFixed(4)),
      p90: Number(percentile(vals, 0.9).toFixed(4)),
      p95: Number(percentile(vals, 0.95).toFixed(4)),
    },
  };
}

function buildDistributionByDomain(rows = [], scoreField = 'top1_score') {
  const byDomain = {};
  for (const domain of OFFICIAL_DOMAINS) {
    byDomain[domain] = { top1: [], correct: [] };
  }
  for (const row of rows) {
    const d = row.domain_selected || row.domain || 'scripts';
    if (!byDomain[d]) byDomain[d] = { top1: [], correct: [] };
    byDomain[d].top1.push(Number(row[scoreField] ?? row.top1_score ?? 0));
    const rank = rankOfCorrect(row.top20 || [], row.correct_chunk_ids);
    if (rank) {
      byDomain[d].correct.push(chunkScore(row.top20[rank - 1]));
    }
  }
  const out = {};
  for (const [domain, buckets] of Object.entries(byDomain)) {
    out[domain] = {
      top1_score: scoreDistribution(buckets.top1),
      correct_chunk_score: scoreDistribution(buckets.correct),
    };
  }
  return out;
}

/**
 * Simula métricas de clasificación por threshold para un conjunto de queries etiquetadas.
 */
function simulateThresholdMetrics(rows = [], threshold = 0.72) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let grounded = 0;
  let fallback = 0;
  let hallucination = 0;
  let citationCoverage = 0;
  let unnecessaryFallback = 0;
  const labeled = rows.filter((r) => r.has_labeled_relevant);
  const n = labeled.length;

  for (const row of labeled) {
    const correctIds =
      row.correct_chunk_ids instanceof Set ? row.correct_chunk_ids : new Set(row.correct_chunk_ids || []);
    const rank = rankOfCorrect(row.top20 || [], correctIds);
    const top1 = row.top20?.[0];
    const top1Score = top1 ? chunkScore(top1) : 0;
    const top1Correct = rank === 1;
    const correctScore = rank ? chunkScore(row.top20[rank - 1]) : 0;
    const correctAbove = rank != null && correctScore >= threshold;
    const top1Above = top1Score >= threshold;
    const top1Wrong = top1Above && !top1Correct;

    if (correctAbove && top1Correct && top1Above) {
      tp += 1;
      grounded += 1;
      citationCoverage += 1;
    } else if (top1Wrong) {
      fp += 1;
      hallucination += 1;
      fallback += 1;
    } else if (correctAbove && !top1Correct) {
      grounded += 1;
      citationCoverage += 1;
      fn += 1;
    } else if (!correctAbove && rank != null) {
      fn += 1;
      fallback += 1;
      unnecessaryFallback += 1;
    } else {
      tn += 1;
      fallback += 1;
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const recallRows = labeled.map((row) => ({
    ...row,
    recall_at_1: recallAtK(row.top20, row.correct_chunk_ids, 1),
    recall_at_3: recallAtK(row.top20, row.correct_chunk_ids, 3),
    recall_at_5: recallAtK(row.top20, row.correct_chunk_ids, 5),
    mrr: mrr(row.top20, row.correct_chunk_ids),
    ndcg_at_10: ndcgAtK(row.top20, row.correct_chunk_ids, 10),
  }));

  const avgRecall = (k) => {
    const vals = recallRows.map((r) => r[`recall_at_${k}`]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  const mrrVals = recallRows.map((r) => r.mrr).filter((v) => v != null);
  const ndcgVals = recallRows.map((r) => r.ndcg_at_10).filter((v) => v != null);

  return {
    threshold,
    sample_labeled: n,
    grounded_rate: n ? grounded / n : 0,
    fallback_rate: n ? fallback / n : 0,
    hallucination_rate: n ? hallucination / n : 0,
    citation_coverage: n ? citationCoverage / n : 0,
    top1_accuracy: n ? tp / n : 0,
    recall_at_1: avgRecall(1),
    recall_at_3: avgRecall(3),
    recall_at_5: avgRecall(5),
    mrr: mrrVals.length ? mrrVals.reduce((a, b) => a + b, 0) / mrrVals.length : 0,
    ndcg_at_10: ndcgVals.length ? ndcgVals.reduce((a, b) => a + b, 0) / ndcgVals.length : 0,
    false_positive_rate: n ? fp / n : 0,
    false_negative_rate: n ? fn / n : 0,
    precision,
    recall,
    f1,
    unnecessary_fallback_rate: n ? unnecessaryFallback / n : 0,
    confusion: { tp, fp, fn, tn },
  };
}

function objectiveScore(metrics, { maxHallucination = 0.02 } = {}) {
  if (metrics.hallucination_rate > maxHallucination) return -1;
  return (
    metrics.grounded_rate * 0.35 +
    metrics.citation_coverage * 0.25 +
    metrics.precision * 0.2 +
    metrics.f1 * 0.15 -
    metrics.unnecessary_fallback_rate * 0.15 -
    metrics.hallucination_rate * 0.5
  );
}

function findOptimalThreshold(rows = [], thresholds = DEFAULT_THRESHOLDS, opts = {}) {
  const maxHall = opts.maxHallucination ?? 0.02;
  let best = null;
  let bestScore = -Infinity;
  const curve = [];

  for (const t of thresholds) {
    const m = simulateThresholdMetrics(rows, t);
    const obj = objectiveScore(m, { maxHallucination: maxHall });
    curve.push({ ...m, objective: obj });
    if (obj > bestScore) {
      bestScore = obj;
      best = { threshold: t, ...m, objective: obj };
    }
  }

  if (!best || bestScore < 0) {
    const fallback = curve.reduce(
      (a, b) => (a.hallucination_rate <= b.hallucination_rate ? a : b),
      curve[0]
    );
    best = { ...fallback, threshold: fallback?.threshold ?? 0.72, note: 'fallback_lowest_hallucination' };
  }

  return { optimal: best, curve };
}

function calibrateDomains(rows = [], thresholds = DEFAULT_THRESHOLDS, opts = {}) {
  const byDomain = {};
  for (const domain of OFFICIAL_DOMAINS) {
    const domainRows = rows.filter(
      (r) => (r.domain_selected || r.domain) === domain && r.has_labeled_relevant
    );
    if (!domainRows.length) {
      byDomain[domain] = {
        sample_size: 0,
        recommended_threshold: 0.72,
        note: 'insufficient_samples',
        curve: [],
      };
      continue;
    }
    const { optimal, curve } = findOptimalThreshold(domainRows, thresholds, opts);
    byDomain[domain] = {
      sample_size: domainRows.length,
      recommended_threshold: optimal.threshold,
      metrics_at_recommended: optimal,
      curve,
    };
  }
  return byDomain;
}

function applyAdaptiveThreshold(row, domainThresholds, fallback = 0.72) {
  const domain = row.domain_selected || row.domain || 'scripts';
  return domainThresholds[domain]?.recommended_threshold ?? domainThresholds[domain] ?? fallback;
}

function compareUniformVsAdaptive(rows = [], domainCalibration = {}, uniformThreshold = 0.72) {
  const domainThresholds = {};
  for (const [domain, cal] of Object.entries(domainCalibration)) {
    domainThresholds[domain] =
      typeof cal === 'number' ? cal : cal.recommended_threshold ?? uniformThreshold;
  }

  const uniform = simulateThresholdMetrics(rows, uniformThreshold);

  const adaptiveRows = rows.map((row) => ({
    ...row,
    _adaptive_threshold: applyAdaptiveThreshold(row, domainThresholds, uniformThreshold),
  }));

  let grounded = 0;
  let fallback = 0;
  let hallucination = 0;
  let citationCoverage = 0;
  const labeled = adaptiveRows.filter((r) => r.has_labeled_relevant);
  const n = labeled.length;

  for (const row of labeled) {
    const t = row._adaptive_threshold;
    const m = simulateThresholdMetrics([row], t);
    if (m.grounded_rate > 0) grounded += 1;
    if (m.fallback_rate > 0) fallback += 1;
    if (m.hallucination_rate > 0) hallucination += 1;
    if (m.citation_coverage > 0) citationCoverage += 1;
  }

  const adaptive = {
    threshold_mode: 'adaptive_per_domain',
    domain_thresholds: domainThresholds,
    sample_labeled: n,
    grounded_rate: n ? grounded / n : 0,
    fallback_rate: n ? fallback / n : 0,
    hallucination_rate: n ? hallucination / n : 0,
    citation_coverage: n ? citationCoverage / n : 0,
  };

  return {
    uniform_threshold: uniformThreshold,
    uniform,
    adaptive,
    delta: {
      grounded_rate: adaptive.grounded_rate - uniform.grounded_rate,
      fallback_rate: adaptive.fallback_rate - uniform.fallback_rate,
      hallucination_rate: adaptive.hallucination_rate - uniform.hallucination_rate,
      citation_coverage: adaptive.citation_coverage - uniform.citation_coverage,
    },
  };
}

function buildRocPoints(curve = []) {
  return curve.map((c) => ({
    threshold: c.threshold,
    tpr: c.recall,
    fpr: c.false_positive_rate,
    precision: c.precision,
  }));
}

module.exports = {
  DEFAULT_THRESHOLDS,
  OFFICIAL_DOMAINS,
  scoreDistribution,
  buildDistributionByDomain,
  simulateThresholdMetrics,
  findOptimalThreshold,
  calibrateDomains,
  compareUniformVsAdaptive,
  buildRocPoints,
  objectiveScore,
};
