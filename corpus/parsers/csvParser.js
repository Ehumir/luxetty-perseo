'use strict';

const { buildConversationRecord } = require('./_shared');

/**
 * CSV columns: corpus_id, turn_index, role, text [, import_batch_id]
 * Header row required.
 * @param {string} text
 * @param {{ file?: string, import_batch_id?: string }} [opts]
 */
function parseCsv(text, opts = {}) {
  const lines = text
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error('CSV must include header and at least one data row');
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = {
    corpus_id: header.indexOf('corpus_id'),
    turn_index: header.indexOf('turn_index'),
    role: header.indexOf('role'),
    text: header.indexOf('text'),
    import_batch_id: header.indexOf('import_batch_id'),
  };
  if (idx.corpus_id < 0 || idx.role < 0 || idx.text < 0) {
    throw new Error('CSV header must include corpus_id, role, text');
  }

  /** @type {Map<string, { turns: { role: string, text: string }[], import_batch_id?: string }>} */
  const groups = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const corpus_id = cols[idx.corpus_id];
    const role = cols[idx.role];
    const turnText = cols[idx.text];
    const batch = idx.import_batch_id >= 0 ? cols[idx.import_batch_id] : opts.import_batch_id;
    if (!groups.has(corpus_id)) groups.set(corpus_id, { turns: [], import_batch_id: batch });
    groups.get(corpus_id).turns.push({ role, text: turnText });
  }

  const records = [];
  for (const [corpus_id, group] of groups) {
    records.push(
      buildConversationRecord({
        corpus_id,
        format: 'csv',
        file: opts.file || 'unknown.csv',
        import_batch_id: group.import_batch_id,
        metadata: { channel: 'whatsapp', language: 'es-MX' },
        labels: { families: [], outcomes: [], risk_tags: [] },
        promotion: { status: 'indexed', promoted_scenario: null, reject_reason: null },
        turns: group.turns,
      }),
    );
  }
  return records.length === 1 ? records[0] : records;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

module.exports = { parseCsv };
