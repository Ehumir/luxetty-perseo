'use strict';

const { buildConversationRecord, parseFrontMatter } = require('./_shared');

const BRACKET = /^\[(user|usuario|assistant|asesor|bot|system)\]\s*(.*)$/i;
const COLON = /^(user|usuario|assistant|asesor|bot|system):\s*(.*)$/i;

/**
 * @param {string} text
 * @param {{ file?: string, import_batch_id?: string }} [opts]
 */
function parseTxt(text, opts = {}) {
  const { meta, body } = parseFrontMatter(text);
  const turns = [];

  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    let role = null;
    let content = null;
    const b = line.match(BRACKET);
    if (b) {
      role = normalizeRole(b[1]);
      content = b[2].trim();
    } else {
      const c = line.match(COLON);
      if (c) {
        role = normalizeRole(c[1]);
        content = c[2].trim();
      }
    }

    if (role && content) {
      turns.push({ role, text: content });
    }
  }

  const corpus_id = meta.corpus_id || inferCorpusId(opts.file);
  return buildConversationRecord({
    corpus_id,
    format: 'txt',
    file: opts.file || meta.file || 'unknown.txt',
    import_batch_id: opts.import_batch_id || meta.import_batch_id,
    metadata: {
      rail_hint: meta.rail_hint || null,
      language: meta.language || 'es-MX',
      channel: meta.channel || 'whatsapp',
    },
    labels: {
      families: [],
      outcomes: meta.outcome ? [meta.outcome] : [],
      risk_tags: [],
    },
    promotion: { status: meta.promotion_status || 'indexed', promoted_scenario: null, reject_reason: null },
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
  if (!file) return 'CORPUS-TXT-UNKNOWN';
  const base = file.replace(/\\/g, '/').split('/').pop() || file;
  return base.replace(/\.[^.]+$/, '').toUpperCase();
}

module.exports = { parseTxt };
