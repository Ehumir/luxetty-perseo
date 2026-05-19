'use strict';

const { cleanSpaces } = require('../../../utils/text');
const { isUnderstandingRuntimeEnabled } = require('../../../config/perseoM401Flags');

const MAX_CHUNK_LEN = 280;
const MAX_SUMMARY_ITEMS = 12;

function chunkInboundMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m, i) => ({
    index: i,
    text: cleanSpaces(typeof m === 'string' ? m : m?.text || ''),
    raw: m,
  }));
}

function fuseTurns(chunks, { gapMs = 120000 } = {}) {
  if (!chunks.length) return { fused_text: '', chunks_used: [] };
  const texts = chunks.map((c) => c.text).filter(Boolean);
  return {
    fused_text: texts.join('\n'),
    chunks_used: chunks.map((c) => c.index),
    fusion_strategy: texts.length > 1 ? 'newline_join' : 'single',
    gap_ms: gapMs,
  };
}

function updateTopicThreads(state, text, decision) {
  const threads = Array.isArray(state?.understanding?.threads)
    ? [...state.understanding.threads]
    : [];
  const goal = decision?.conversation_goal || state?.conversationGoal;
  if (goal && !threads.find((t) => t.goal === goal)) {
    threads.push({ goal, updated_at: new Date().toISOString() });
  }
  const lower = cleanSpaces(text).toLowerCase();
  if (/vendo|venta|vender/.test(lower) && !threads.find((t) => t.goal === 'sell')) {
    threads.push({ goal: 'sell', updated_at: new Date().toISOString() });
  }
  if (/compro|compra|busco casa/.test(lower) && !threads.find((t) => t.goal === 'buy')) {
    threads.push({ goal: 'buy', updated_at: new Date().toISOString() });
  }
  if (/rento|renta|arrend/.test(lower) && !threads.find((t) => t.goal === 'rent')) {
    threads.push({ goal: 'rent', updated_at: new Date().toISOString() });
  }
  return threads.slice(-5);
}

function buildIntentTimeline(state, decision) {
  const prev = Array.isArray(state?.understanding?.intent_timeline)
    ? state.understanding.intent_timeline
    : [];
  const entry = {
    at: new Date().toISOString(),
    intent: decision?.intent || decision?.detected_intent || null,
    stage: state?.qualificationStage || null,
  };
  if (!entry.intent) return prev;
  return [...prev, entry].slice(-MAX_SUMMARY_ITEMS);
}

function buildConversationMemorySummary(state) {
  const parts = [];
  const name = state?.entityTracker?.name || state?.contactName;
  const zone = state?.filters?.zone || state?.activeProperty?.zone;
  const budget = state?.filters?.budget_max || state?.filters?.budget;
  if (name) parts.push(`nombre:${name}`);
  if (zone) parts.push(`zona:${zone}`);
  if (budget) parts.push(`presupuesto:${budget}`);
  const threads = state?.understanding?.threads || [];
  if (threads.length) parts.push(`threads:${threads.map((t) => t.goal).join(',')}`);
  return parts.join(' | ').slice(0, 500);
}

/**
 * @param {{ state: object, inboundText: string, recentMessages?: string[], decision?: object }} input
 */
function runUnderstandingRuntime(input) {
  if (!isUnderstandingRuntimeEnabled()) return null;

  const { state, inboundText, recentMessages = [], decision = {} } = input;
  const chunks = chunkInboundMessages(
    recentMessages.length ? recentMessages : [inboundText],
  );
  const fusion = fuseTurns(chunks);
  const threads = updateTopicThreads(state, fusion.fused_text || inboundText, decision);
  const intent_timeline = buildIntentTimeline(state, decision);
  const memory_summary = buildConversationMemorySummary({
    ...state,
    understanding: { ...state?.understanding, threads },
  });

  return {
    patch: {
      understanding: {
        chunks: chunks.map((c) => ({ index: c.index, len: c.text.length })),
        fused_turn: fusion,
        threads,
        intent_timeline,
        memory_summary,
        last_fusion_at: new Date().toISOString(),
      },
      lastFusedUserText: fusion.fused_text || inboundText,
    },
    metrics: {
      chunk_count: chunks.length,
      thread_count: threads.length,
    },
  };
}

module.exports = {
  chunkInboundMessages,
  fuseTurns,
  updateTopicThreads,
  buildIntentTimeline,
  buildConversationMemorySummary,
  runUnderstandingRuntime,
  MAX_CHUNK_LEN,
};
