'use strict';

const { buildConversationRecord } = require('./_shared');

/**
 * @param {string} text
 * @param {{ file?: string, import_batch_id?: string }} [opts]
 */
function parseJson(text, opts = {}) {
  const parsed = JSON.parse(text);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const records = items.map((item) => normalizeJsonRecord(item, opts));
  return records.length === 1 ? records[0] : records;
}

function normalizeJsonRecord(item, opts) {
  if (item.record_schema_version && item.turns) {
    return buildConversationRecord({
      corpus_id: item.corpus_id,
      format: 'json',
      file: item.source?.file || opts.file || 'unknown.json',
      import_batch_id: item.source?.import_batch_id || opts.import_batch_id,
      metadata: item.metadata,
      labels: item.labels,
      promotion: item.promotion,
      risk_tags: item.risk_tags,
      policy_tags: item.policy_tags,
      attachments: item.attachments,
      turns: item.turns.map((t) => ({
        role: t.role,
        text: t.text,
        attachments: t.attachments,
        trace_ref: t.trace_ref,
      })),
    });
  }
  throw new Error('JSON must be ConversationRecordV1 object or array');
}

module.exports = { parseJson };
