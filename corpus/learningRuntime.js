'use strict';

const path = require('node:path');
const { isLearningRuntimeEnabled } = require('../config/perseoM401Flags');
const { parseFile, PARSERS } = require('./parsers');

const CLASSIFICATION_TAGS = ['handoff', 'policy', 'media', 'crm', 'resilience', 'general'];

/**
 * Basic corpus classification — no auto-promote.
 */
function classifyCorpusRecord(record) {
  const text = `${record?.user_message || ''} ${record?.assistant_message || ''}`.toLowerCase();
  const tags = [];
  if (/asesor|humano|handoff/.test(text)) tags.push('handoff');
  if (/zona|cumbres|pol[ií]tica|decline/.test(text)) tags.push('policy');
  if (/audio|imagen|pdf|documento/.test(text)) tags.push('media');
  if (/lead|crm|contacto/.test(text)) tags.push('crm');
  if (/confuso|loop|repet/.test(text)) tags.push('resilience');
  if (!tags.length) tags.push('general');
  return { tags, primary: tags[0] };
}

/**
 * Suggest ARGOS scenario candidates for human review — never writes manifest.
 */
function suggestScenarioCandidates(record, classification) {
  const family = classification?.primary || 'general';
  const code = `SUGGEST_${family.toUpperCase()}_${String(record?.corpus_id || 'unknown')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, 24)}`;
  const { scoreScenarioCandidate } = require('./learningReviewQueue');
  const confidence = scoreScenarioCandidate(record, classification);
  return {
    scenario_code: code,
    family,
    status: 'candidate',
    promoted: false,
    requires_review: true,
    confidence,
    source_corpus_id: record?.corpus_id || null,
    rationale: `Auto-suggested from learning runtime; classification=${family}; confidence=${confidence.toFixed(2)}`,
  };
}

function buildExploratoryRunMetadata({ batchId, file, parser }) {
  return {
    exploratory: true,
    promoted: false,
    import_batch_id: batchId || null,
    source_file: file || null,
    parser: parser || null,
    recorded_at: new Date().toISOString(),
  };
}

/**
 * Parse file with DOCX/PDF when learning runtime enabled.
 */
function parseFileForLearning(filePath, opts = {}) {
  const ext = path.extname(filePath).toLowerCase();
  if ((ext === '.docx' || ext === '.pdf') && !isLearningRuntimeEnabled()) {
    throw new Error(`Learning runtime disabled for ${ext}`);
  }
  const records = parseFile(filePath, opts);
  return records.map((r) => ({
    ...r,
    classification: classifyCorpusRecord(r),
    exploratory: buildExploratoryRunMetadata({
      batchId: opts.import_batch_id,
      file: path.basename(filePath),
      parser: PARSERS[ext]?.format,
    }),
  }));
}

module.exports = {
  CLASSIFICATION_TAGS,
  classifyCorpusRecord,
  suggestScenarioCandidates,
  buildExploratoryRunMetadata,
  parseFileForLearning,
};
