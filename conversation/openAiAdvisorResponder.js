'use strict';

const { cleanSpaces } = require('../utils/text');

function hasSupabaseUrl(text = '') {
  return /supabase\.co|storage\.googleapis\.com|amazonaws\.com/i.test(String(text));
}

function sanitizeAdvisorOutput(text = '', context = {}) {
  const raw = cleanSpaces(String(text || ''));
  if (!raw) return '';
  if (hasSupabaseUrl(raw)) {
    return raw.replace(/https?:\/\/\S*(supabase\.co|storage\.googleapis\.com|amazonaws\.com)\S*/gi, '').trim();
  }
  return raw;
}

async function generateAdvisorReply(context = {}, options = {}) {
  const payload = {
    user_message: context.user_message || '',
    synthetic_state: context.ai_state || {},
    signals: {
      ...(context.signals || {}),
      advisor_context: context,
    },
    recent_messages: Array.isArray(context.recent_messages) ? context.recent_messages : [],
    recent_db_messages_for_card_check: Array.isArray(context.recent_messages) ? context.recent_messages : [],
    suggested_properties: context.current_property ? [context.current_property] : [],
    last_suggested_property: context.current_property || null,
    contact: context.contact || null,
    budget: context.buyer_context?.budget_max ?? null,
    budget_currency: context.buyer_context?.budget_currency || 'MXN',
    zone: context.buyer_context?.location_text || '',
    operation: context.seller_context?.operation_type || null,
    missing_name: !!context.user?.missing_name,
    follow_up_reason: context.conversational_goal || 'advisor_context',
    conversation_id: context.conversation_id || null,
  };

  const fn =
    options.generateAdvisorReplyForRealEstateTurn ||
    require('./realEstateAdvisorReply').generateAdvisorReplyForRealEstateTurn;
  const out = await fn(payload, {
    model: options.model,
    openaiClient: options.openaiClient,
  });

  const text = sanitizeAdvisorOutput(out?.text || '', context);
  return {
    text,
    raw: out,
    used_openai_advisor: !!out?.used_openai_advisor,
  };
}

module.exports = {
  generateAdvisorReply,
  sanitizeAdvisorOutput,
};
