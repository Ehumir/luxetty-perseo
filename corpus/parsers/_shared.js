'use strict';

const { RECORD_SCHEMA_VERSION } = require('../constants');
const { computeOutcomeHash } = require('../outcomeHash');

/**
 * @param {object} partial
 */
function buildConversationRecord(partial) {
  const turns = (partial.turns || []).map((t, index) => ({
    index,
    role: t.role,
    text: String(t.text || '').trim(),
    attachments: t.attachments || [],
    ...(t.trace_ref != null ? { trace_ref: t.trace_ref } : {}),
  }));

  const record = {
    record_schema_version: RECORD_SCHEMA_VERSION,
    corpus_id: partial.corpus_id,
    source: {
      format: partial.source?.format || partial.format,
      file: partial.source?.file || partial.file,
      imported_at: partial.source?.imported_at || new Date().toISOString(),
      ...(partial.source?.import_batch_id
        ? { import_batch_id: partial.source.import_batch_id }
        : partial.import_batch_id
          ? { import_batch_id: partial.import_batch_id }
          : {}),
    },
    metadata: partial.metadata || {},
    turns,
    labels: partial.labels || { families: [], outcomes: [], risk_tags: [] },
    promotion: partial.promotion || { status: 'indexed', promoted_scenario: null, reject_reason: null },
    attachments: partial.attachments || [],
    risk_tags: partial.risk_tags || partial.labels?.risk_tags || [],
    policy_tags: partial.policy_tags || partial.labels?.policy_tags || [],
  };

  record.outcome_hash = computeOutcomeHash(record);
  return record;
}

function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.+)$/i);
    if (m) meta[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return { meta, body: match[2] };
}

module.exports = { buildConversationRecord, parseFrontMatter };
