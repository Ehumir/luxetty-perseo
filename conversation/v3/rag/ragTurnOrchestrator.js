'use strict';

const { getAccRagP0FlagSnapshot, isRagRulesEffectiveForUser } = require('../../../config/accP0Flags');
const ragRulesService = require('../../../services/ragRulesService');
const { canAssertClaim } = require('./ragPolicy');

const RULES_INTENT_PATTERNS = [
  { domain: 'commercial_objections', re: /\bcomisi[oó]n\b|\bexclusiv|\bvaluaci[oó]n\b|\bcu[aá]nto\s+cobran\b/i },
  { domain: 'rules_perseo', re: /\bpol[ií]tica\b|\bregla\b|\bno\s+invent/i },
  { domain: 'rules_atena', re: /\bsolicitud\b|\blead\b|\bcontacto\b/i },
  { domain: 'assignment_rules', re: /\basignaci[oó]n\b|\bownership\b|\bdue[nñ]o\b/i },
  { domain: 'campaigns', re: /\bcampa[nñ]a\b|\bpauta\b|\bmeta\b/i },
  { domain: 'zones', re: /\bcolonia\b|\bzona\b|\bubicaci[oó]n\b/i },
];

/**
 * Detecta dominio de reglas a recuperar desde texto (sin interpretar negocio).
 * @param {string} text
 * @returns {string|null}
 */
function detectRulesDomain(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const { domain, re } of RULES_INTENT_PATTERNS) {
    if (re.test(t)) return domain;
  }
  return null;
}

/**
 * Extrae excerpt grounded seguro para enriquecer copy (sin mostrar citation al usuario).
 */
function pickGroundedExcerpt(contextPack, { minConfidence = 0.72 } = {}) {
  if (!contextPack || contextPack.fallback_used) return null;
  if (!canAssertClaim({ confidence: contextPack.confidence, citations: contextPack.citations, minConfidence })) {
    return null;
  }
  const top = contextPack.citations?.[0];
  if (!top?.excerpt) return null;
  return String(top.excerpt).slice(0, 180).trim();
}

/**
 * Orquesta contexto RAG de reglas para un turno conversacional (canary only).
 */
async function enrichTurnWithRagContext(
  db,
  {
    text,
    phone,
    conversationId = null,
    messageId = null,
    saveConversationEvent = null,
    logger = console,
  } = {}
) {
  const flags = getAccRagP0FlagSnapshot();
  const allowlistEligible = isRagRulesEffectiveForUser(phone);

  if (!allowlistEligible) {
    return {
      contextPack: null,
      meta: {
        skipped: true,
        reason: 'not_eligible',
        flags,
        allowlist_eligible: false,
      },
    };
  }

  const domain = detectRulesDomain(text);
  if (!domain) {
    return {
      contextPack: null,
      meta: {
        skipped: true,
        reason: 'no_rules_intent',
        flags,
        allowlist_eligible: true,
      },
    };
  }

  const start = Date.now();
  try {
    const rulesResult = await ragRulesService.fetchRulesContextPack(db, { query: text, domain, logger });
    const contextPack = rulesResult?.contextPack || null;
    const latencyMs = Date.now() - start;
    const meta = {
      skipped: false,
      domain,
      flags,
      allowlist_eligible: true,
      confidence: contextPack?.confidence ?? 0,
      chunks_selected: contextPack?.chunks_selected ?? 0,
      chunks_dropped: contextPack?.chunks_dropped ?? 0,
      citations_count: contextPack?.citations?.length ?? 0,
      fallback_used: contextPack?.fallback_used ?? rulesResult?.fallback ?? true,
      latency_ms: latencyMs,
      rag_query_log_id: contextPack?.rag_query_log_id || null,
    };

    if (typeof saveConversationEvent === 'function' && conversationId) {
      await saveConversationEvent(conversationId, 'rag_retrieval', {
        domain,
        message_id: messageId || null,
        confidence: meta.confidence,
        chunks_selected: meta.chunks_selected,
        chunks_dropped: meta.chunks_dropped,
        citations_count: meta.citations_count,
        fallback_used: meta.fallback_used,
        fallback_reason: meta.fallback_used ? 'low_confidence_or_empty' : null,
        latency_ms: meta.latency_ms,
        rag_query_log_id: meta.rag_query_log_id,
        flags,
        allowlist_eligible: true,
      });
    }

    return { contextPack, meta };
  } catch (err) {
    logger.warn?.('rag_turn_orchestrator_failed', { error: String(err?.message || err) });
    const meta = {
      skipped: false,
      domain,
      flags,
      allowlist_eligible: true,
      fallback_used: true,
      fallback_reason: 'exception',
      latency_ms: Date.now() - start,
    };
    if (typeof saveConversationEvent === 'function' && conversationId) {
      await saveConversationEvent(conversationId, 'rag_retrieval', {
        domain,
        message_id: messageId || null,
        fallback_used: true,
        fallback_reason: 'exception',
        flags,
        allowlist_eligible: true,
      });
    }
    return { contextPack: null, meta };
  }
}

module.exports = {
  RULES_INTENT_PATTERNS,
  detectRulesDomain,
  pickGroundedExcerpt,
  enrichTurnWithRagContext,
};
