'use strict';

const crypto = require('node:crypto');

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Stable behavioral fingerprint for dedupe (not cryptographic security).
 * @param {import('./types').ConversationRecordV1} record
 */
function computeOutcomeHash(record) {
  const payload = {
    record_schema_version: record.record_schema_version || '1.0',
    metadata: {
      rail_hint: record.metadata?.rail_hint || null,
      typology_block: record.metadata?.typology_block || null,
      channel: record.metadata?.channel || null,
    },
    labels: {
      families: [...(record.labels?.families || [])].sort(),
      outcomes: [...(record.labels?.outcomes || [])].sort(),
      risk_tags: [...(record.labels?.risk_tags || [])].sort(),
      policy_tags: [...(record.labels?.policy_tags || record.policy_tags || [])].sort(),
    },
    turns: (record.turns || []).map((t) => ({
      role: t.role,
      text: normalizeText(t.text),
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

module.exports = { computeOutcomeHash, normalizeText };
