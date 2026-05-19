'use strict';

const { buildConversationRecord, parseFrontMatter } = require('./_shared');

const ROLE_LINE = /^\*\*(User|Usuario|Assistant|Asesor|Bot|System):\*\*\s*(.*)$/i;
const BULLET_ROLE = /^[-*]\s*(user|usuario|assistant|asesor|system):\s*(.*)$/i;

/**
 * @param {string} text
 * @param {{ file?: string, import_batch_id?: string }} [opts]
 */
function parseMd(text, opts = {}) {
  const { meta, body } = parseFrontMatter(text);
  const turns = [];
  let current = null;

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let role = null;
    let content = null;
    const star = line.match(ROLE_LINE);
    if (star) {
      role = normalizeRole(star[1]);
      content = star[2].trim();
    } else {
      const bullet = line.match(BULLET_ROLE);
      if (bullet) {
        role = normalizeRole(bullet[1]);
        content = bullet[2].trim();
      }
    }

    if (role && content) {
      if (current) turns.push(current);
      current = { role, text: content };
    } else if (current) {
      current.text += `\n${line}`;
    }
  }
  if (current) turns.push(current);

  const corpus_id = meta.corpus_id || meta.corpusId || inferCorpusId(opts.file);
  return buildConversationRecord({
    corpus_id,
    format: 'md',
    file: opts.file || meta.file || 'unknown.md',
    import_batch_id: opts.import_batch_id || meta.import_batch_id,
    metadata: {
      rail_hint: meta.rail_hint || meta.rail || null,
      typology_block: meta.typology_block || null,
      language: meta.language || 'es-MX',
      channel: meta.channel || 'whatsapp',
    },
    labels: {
      families: meta.families ? meta.families.split(',').map((s) => s.trim()) : [],
      outcomes: meta.outcomes ? meta.outcomes.split(',').map((s) => s.trim()) : [],
      risk_tags: meta.risk_tags ? meta.risk_tags.split(',').map((s) => s.trim()) : [],
    },
    promotion: {
      status: meta.promotion_status || 'indexed',
      promoted_scenario: meta.promoted_scenario || null,
      reject_reason: null,
    },
    policy_tags: meta.policy_tags ? meta.policy_tags.split(',').map((s) => s.trim()) : [],
    turns,
  });
}

function normalizeRole(raw) {
  const r = String(raw).toLowerCase();
  if (r === 'usuario' || r === 'user') return 'user';
  if (r === 'asesor' || r === 'assistant' || r === 'bot') return 'assistant';
  if (r === 'system') return 'system';
  return 'user';
}

function inferCorpusId(file) {
  if (!file) return 'CORPUS-MD-UNKNOWN';
  const base = file.replace(/\\/g, '/').split('/').pop() || file;
  return base.replace(/\.[^.]+$/, '').toUpperCase();
}

module.exports = { parseMd };
