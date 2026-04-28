const { getDefaultAiState, normalizeAiState } = require('../conversation/aiState');
const { nowIso } = require('../utils/helpers');

const FOLLOWUP_STEPS = [
  {
    key: '1h',
    eventType: 'followup_1h_sent',
    minAgeMs: 60 * 60 * 1000,
    message: '¿Quieres que te ayude a avanzar con esto?',
  },
  {
    key: '6h',
    eventType: 'followup_6h_sent',
    minAgeMs: 6 * 60 * 60 * 1000,
    message: 'Puedo conectarte con un asesor cuando gustes para revisar esta solicitud.',
  },
  {
    key: '20h',
    eventType: 'followup_20h_sent',
    minAgeMs: 20 * 60 * 60 * 1000,
    message: '¿Seguimos con esto o prefieres retomarlo después?',
  },
];

const CLOSE_STEP = {
  key: '23h',
  eventType: 'conversation_closed_by_inactivity',
  minAgeMs: 23 * 60 * 60 * 1000,
  message:
    'Fue un gusto atenderte. Cierro esta conversación por ahora, pero cuando quieras retomarla solo escríbeme y con gusto te ayudo.',
};

function isClosedStatus(status) {
  return ['closed', 'inactive', 'resolved', 'archived'].includes(String(status || '').toLowerCase());
}

function isHumanOutbound(message) {
  if (!message || message.direction !== 'outbound') return false;
  return !['ai_agent', 'system'].includes(String(message.sender_type || '').toLowerCase());
}

function resetAiStateForClosedConversation(rawState) {
  const previous = normalizeAiState(rawState);
  return {
    ...getDefaultAiState(),
    lead_id: previous.lead_id || null,
    assigned_agent_profile_id: previous.assigned_agent_profile_id || null,
    last_completed_lead: previous.last_completed_lead || null,
    closed_by_inactivity_at: nowIso(),
    last_change_type: 'conversation_closed_by_inactivity',
    intent_version: (previous.intent_version || 1) + 1,
  };
}

async function saveConversationEvent(supabase, conversationId, type, payload = {}) {
  const { error } = await supabase.from('conversation_events').insert({
    conversation_id: conversationId,
    type,
    payload,
  });

  if (error) {
    console.error('FOLLOWUP_EVENT_ERROR', { conversation_id: conversationId, type, error: error.message });
  }
}

async function loadConversationMessages(supabase, conversationId) {
  const { data, error } = await supabase
    .from('conversation_messages')
    .select('id, direction, sender_type, message_type, message_text, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('FOLLOWUP_MESSAGES_ERROR', { conversation_id: conversationId, error: error.message });
    return [];
  }

  return data || [];
}

async function loadConversationEvents(supabase, conversationId) {
  const eventTypes = [
    ...FOLLOWUP_STEPS.map((step) => step.eventType),
    CLOSE_STEP.eventType,
  ];

  const { data, error } = await supabase
    .from('conversation_events')
    .select('type, created_at')
    .eq('conversation_id', conversationId)
    .in('type', eventTypes);

  if (error) {
    console.error('FOLLOWUP_EVENTS_ERROR', { conversation_id: conversationId, error: error.message });
    return new Set();
  }

  return new Set((data || []).map((event) => event.type));
}

async function saveOutboundFollowupMessage(supabase, conversationId, messageText, stepKey) {
  const { error: messageError } = await supabase.from('conversation_messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    sender_type: 'ai_agent',
    message_type: 'text',
    message_text: messageText,
    raw_payload: { automation: 'inactivity_followup', step: stepKey },
  });

  if (messageError) {
    console.error('FOLLOWUP_MESSAGE_SAVE_ERROR', {
      conversation_id: conversationId,
      step: stepKey,
      error: messageError.message,
    });
  }

  await supabase
    .from('conversations')
    .update({ last_message_at: nowIso(), updated_at: nowIso() })
    .eq('id', conversationId);
}

function getNextDueAction({ messages, sentEvents, now }) {
  if (!messages.length) return null;

  const lastMessage = messages[messages.length - 1];
  const lastInbound = [...messages].reverse().find((message) => message.direction === 'inbound');
  const lastOutbound = [...messages].reverse().find((message) => message.direction === 'outbound');

  if (!lastInbound || !lastOutbound) return null;
  if (lastMessage.direction === 'inbound') return null;
  if (isHumanOutbound(lastOutbound)) return null;

  const lastInboundAt = new Date(lastInbound.created_at).getTime();
  if (!Number.isFinite(lastInboundAt)) return null;

  const ageMs = now.getTime() - lastInboundAt;
  if (ageMs < FOLLOWUP_STEPS[0].minAgeMs) return null;

  if (ageMs >= CLOSE_STEP.minAgeMs && !sentEvents.has(CLOSE_STEP.eventType)) {
    return { kind: 'close', step: CLOSE_STEP, ageMs };
  }

  for (const step of FOLLOWUP_STEPS) {
    if (ageMs >= step.minAgeMs && !sentEvents.has(step.eventType)) {
      return { kind: 'followup', step, ageMs };
    }
  }

  return null;
}

async function sendFollowup({ supabase, sendWhatsAppText, conversation, action }) {
  const phone = conversation.phone;
  const { step } = action;

  if (!phone) {
    await saveConversationEvent(supabase, conversation.id, `${step.eventType}_skipped`, {
      reason: 'missing_phone',
      step: step.key,
    });
    return { sent: false, reason: 'missing_phone' };
  }

  await sendWhatsAppText(phone, step.message);
  await saveOutboundFollowupMessage(supabase, conversation.id, step.message, step.key);
  await saveConversationEvent(supabase, conversation.id, step.eventType, {
    step: step.key,
    age_ms: action.ageMs,
    source: 'inactivity_followup_job',
  });

  return { sent: true, reason: step.eventType };
}

async function closeConversation({ supabase, sendWhatsAppText, conversation, action }) {
  const sendResult = await sendFollowup({ supabase, sendWhatsAppText, conversation, action });
  if (!sendResult.sent) return sendResult;

  const nextAiState = resetAiStateForClosedConversation(conversation.ai_state);
  const { error } = await supabase
    .from('conversations')
    .update({
      status: 'closed',
      follow_up_status: 'closed',
      next_action: null,
      next_action_due_at: null,
      ai_state: nextAiState,
      updated_at: nowIso(),
    })
    .eq('id', conversation.id);

  if (error) {
    console.error('FOLLOWUP_CLOSE_CONVERSATION_ERROR', {
      conversation_id: conversation.id,
      error: error.message,
    });
    return { sent: true, closed: false, reason: 'conversation_close_failed' };
  }

  return { sent: true, closed: true, reason: CLOSE_STEP.eventType };
}

async function runInactivityFollowups({
  supabase,
  sendWhatsAppText,
  now = new Date(),
  limit = 50,
  logger = console,
}) {
  if (!supabase || !sendWhatsAppText) {
    throw new Error('supabase_and_sendWhatsAppText_required');
  }

  const { data: conversations, error } = await supabase
    .from('conversations')
    .select('id, phone, status, channel, ai_state, assigned_agent_profile_id, last_message_at, updated_at')
    .eq('channel', 'whatsapp')
    .in('status', ['open', 'pending', 'escalated'])
    .order('last_message_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`followup_conversation_query_failed:${error.message}`);
  }

  const summary = {
    checked: 0,
    sent: 0,
    closed: 0,
    skipped: 0,
    errors: 0,
  };

  for (const conversation of conversations || []) {
    summary.checked += 1;

    try {
      if (isClosedStatus(conversation.status)) {
        summary.skipped += 1;
        continue;
      }

      const messages = await loadConversationMessages(supabase, conversation.id);
      const sentEvents = await loadConversationEvents(supabase, conversation.id);
      const action = getNextDueAction({ messages, sentEvents, now });

      if (!action) {
        summary.skipped += 1;
        continue;
      }

      const result =
        action.kind === 'close'
          ? await closeConversation({ supabase, sendWhatsAppText, conversation, action })
          : await sendFollowup({ supabase, sendWhatsAppText, conversation, action });

      if (result.closed) summary.closed += 1;
      if (result.sent) summary.sent += 1;
      if (!result.sent) summary.skipped += 1;
    } catch (err) {
      summary.errors += 1;
      logger.warn('FOLLOWUP_AUTOMATION_ERROR', {
        conversation_id: conversation.id,
        error: err?.message || String(err),
      });
    }
  }

  return summary;
}

module.exports = {
  FOLLOWUP_STEPS,
  CLOSE_STEP,
  getNextDueAction,
  resetAiStateForClosedConversation,
  runInactivityFollowups,
};
