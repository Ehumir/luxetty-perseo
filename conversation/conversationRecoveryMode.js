'use strict';

const { normalizeText } = require('../utils/text');
const { generateAdvisorReply } = require('./openAiAdvisorResponder');

function hasForbiddenPhrase(text = '', forbidden = []) {
  const t = normalizeText(text);
  const list = Array.isArray(forbidden) ? forbidden : [];
  return list.some((p) => t.includes(normalizeText(String(p))));
}

function hasFrustrationSignal(context = {}) {
  const userText = normalizeText(context.user_message || '');
  if (userText.includes('bot') || userText.includes('no me entiendes') || userText.includes('no me estas entendiendo')) {
    return true;
  }
  return context.emotional_signal === 'frustration';
}

function shouldActivateRecoveryMode(context = {}) {
  if (hasFrustrationSignal(context)) return true;
  if (context.playbook_conflict) return true;
  if (context.anti_loop_detected) return true;
  if (hasForbiddenPhrase(context.generated_reply, context.forbidden_phrases)) return true;
  if (context.repeat_count >= 2) return true;
  return false;
}

function buildRecoveryContext(context = {}) {
  return {
    ...context,
    conversational_goal: 'recovery_natural_reply',
    anti_loop_detected: true,
    emotional_signal: hasFrustrationSignal(context) ? 'frustration' : context.emotional_signal || 'neutral',
  };
}

async function generateRecoveryResponse(context = {}, options = {}) {
  const recovery = buildRecoveryContext(context);
  return generateAdvisorReply(recovery, options);
}

module.exports = {
  shouldActivateRecoveryMode,
  buildRecoveryContext,
  generateRecoveryResponse,
  hasForbiddenPhrase,
};
