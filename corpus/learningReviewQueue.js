'use strict';

/**
 * M4-02 foundation — scenario candidates + human review queue (no auto-promote).
 */

/** @type {Map<string, object>} */
const reviewQueue = new Map();

function queueKey(id) {
  return String(id || '').trim();
}

/**
 * @param {object} candidate from suggestScenarioCandidates
 * @param {{ confidence?: number, source?: string }} meta
 */
function enqueueScenarioCandidate(candidate, meta = {}) {
  const confidence = Number(meta.confidence ?? candidate.confidence ?? 0.5);
  const id = candidate.scenario_code || `CAND_${Date.now()}`;
  const row = {
    id,
    scenario_code: candidate.scenario_code,
    family: candidate.family,
    status: 'pending_review',
    confidence,
    requires_review: true,
    promoted: false,
    rationale: candidate.rationale || null,
    source_corpus_id: candidate.source_corpus_id || null,
    queued_at: new Date().toISOString(),
    metadata: { source: meta.source || 'learning_runtime' },
  };
  reviewQueue.set(queueKey(id), row);
  return row;
}

function listPendingReview({ minConfidence = 0 } = {}) {
  return [...reviewQueue.values()].filter(
    (r) => r.status === 'pending_review' && r.confidence >= minConfidence,
  );
}

function markReviewed(id, { approved = false, reviewer = null, notes = null } = {}) {
  const row = reviewQueue.get(queueKey(id));
  if (!row) return null;
  row.status = approved ? 'approved' : 'rejected';
  row.reviewed_at = new Date().toISOString();
  row.reviewer = reviewer;
  row.notes = notes;
  return row;
}

function resetReviewQueue() {
  reviewQueue.clear();
}

function scoreScenarioCandidate(record, classification) {
  let score = 0.5;
  if (classification?.primary === 'policy') score += 0.15;
  if (classification?.primary === 'crm') score += 0.1;
  if (classification?.primary === 'media') score += 0.1;
  if (record?.exploratory?.promoted === false) score += 0.05;
  return Math.min(0.95, score);
}

module.exports = {
  enqueueScenarioCandidate,
  listPendingReview,
  markReviewed,
  resetReviewQueue,
  scoreScenarioCandidate,
};
