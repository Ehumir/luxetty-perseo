'use strict';

const { computeOutcomeHash } = require('./outcomeHash');
const { validateConversationRecord } = require('./validateConversationRecord');

/**
 * @typedef {object} DedupeDuplicate
 * @property {string} outcome_hash
 * @property {string[]} corpus_ids
 * @property {string[]} files
 */

/**
 * @param {object[]} records
 * @param {{ fileByCorpusId?: Map<string, string> }} [opts]
 * @returns {{ unique: object[], duplicates: DedupeDuplicate[], invalid: { corpus_id?: string, file?: string, issues: object[] }[] }}
 */
function dedupeConversationRecords(records, opts = {}) {
  const fileByCorpusId = opts.fileByCorpusId || new Map();
  const byHash = new Map();
  const byCorpusId = new Map();
  const invalid = [];
  const unique = [];

  for (const raw of records) {
    const corpus_id = raw?.corpus_id;
    const file = corpus_id ? fileByCorpusId.get(corpus_id) : undefined;
    const validation = validateConversationRecord(raw);
    if (!validation.ok) {
      invalid.push({ corpus_id, file, issues: validation.issues });
      continue;
    }

    const hash = validation.outcome_hash || computeOutcomeHash(raw);
    const enriched = { ...raw, outcome_hash: hash };

    if (corpus_id && byCorpusId.has(corpus_id)) {
      invalid.push({
        corpus_id,
        file,
        issues: [{ level: 'error', code: 'duplicate_corpus_id', message: 'duplicate corpus_id in batch' }],
      });
      continue;
    }
    if (corpus_id) byCorpusId.set(corpus_id, enriched);

    const list = byHash.get(hash) || [];
    list.push({ record: enriched, file, corpus_id });
    byHash.set(hash, list);
  }

  const duplicates = [];
  for (const [outcome_hash, list] of byHash) {
    if (list.length > 1) {
      duplicates.push({
        outcome_hash,
        corpus_ids: list.map((x) => x.corpus_id).filter(Boolean),
        files: list.map((x) => x.file).filter(Boolean),
      });
    } else {
      unique.push(list[0].record);
    }
  }

  return { unique, duplicates, invalid };
}

module.exports = { dedupeConversationRecords };
