'use strict';

/**
 * Context / Memory merge antes del Conversation Engine y Advisor.
 */

const { applyPriorityToSignals } = require('./conversationPriorityResolver');
const r0 = require('./r0ContextContinuity');
const conversationMode = require('./conversationMode');
const { cleanSpaces } = require('../utils/text');

/**
 * @returns {{ signals: object, statePatch: object, metrics: object }}
 */
function mergeContextBeforeAdvisor(context = {}) {
  const {
    text = '',
    previousAiState = {},
    nextAiState = {},
    parsedSignals = {},
    campaignContext = null,
  } = context;

  const prev = previousAiState && typeof previousAiState === 'object' ? previousAiState : {};
  let signals = applyPriorityToSignals(parsedSignals, text, prev);
  signals = r0.applyR0StickySignalsGuard(prev, signals, text);

  const priority = signals.__priority_intent || null;
  const statePatch = {};

  if (priority?.lead_flow === 'offer' || r0.isR0StickySaleCaptureThread({ ...prev, ...nextAiState, ...signals })) {
    statePatch.lead_flow = 'offer';
    if (!nextAiState.operation_type && !signals.operation_type) {
      statePatch.operation_type = 'sale';
    }
  }

  if (priority?.entry_type) {
    statePatch.entry_point_last = {
      ...(prev.entry_point_last && typeof prev.entry_point_last === 'object' ? prev.entry_point_last : {}),
      entry_type: priority.entry_type,
      lead_flow: priority.lead_flow,
      location_text:
        cleanSpaces(String(signals.location_text || nextAiState.location_text || prev.location_text || '')) ||
        null,
    };
  }

  if (priority?.opening_type) {
    statePatch.opening_type = priority.opening_type;
  }

  if (campaignContext && typeof campaignContext === 'object') {
    statePatch.campaign_context = {
      ...(prev.campaign_context && typeof prev.campaign_context === 'object' ? prev.campaign_context : {}),
      ...campaignContext,
    };
  }

  const mode = conversationMode.getConversationMode({ ...prev, ...nextAiState, ...statePatch });
  statePatch.conversation_mode = mode;

  return {
    signals,
    statePatch,
    metrics: {
      entry_type: priority?.entry_type || null,
      opening_type: priority?.opening_type || null,
      conversation_mode: mode,
      priority_key: priority?.key || null,
      flow_switch: !!(priority?.lead_flow && prev.lead_flow && priority.lead_flow !== prev.lead_flow),
    },
  };
}

module.exports = {
  mergeContextBeforeAdvisor,
};
