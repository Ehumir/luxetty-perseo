'use strict';

const express = require('express');
const { supabase } = require('../services/supabaseService');
const { sendPerseoAutomatedWhatsApp } = require('../services/perseoAutomatedWhatsApp');
const { saveOutboundMessages } = require('../services/saveOutboundMessages');
const { runInactivityFollowups } = require('../services/followupAutomation');
const router = express.Router();

function isFollowupsJobEnabled() {
  return process.env.PERSEO_INACTIVITY_FOLLOWUPS_ENABLED !== 'false';
}

async function saveConversationEventForJob(conversationId, type, payload = {}) {
  if (!conversationId) return;
  const { error } = await supabase.from('conversation_events').insert({
    conversation_id: conversationId,
    type,
    payload,
  });
  if (error) {
    console.error('FOLLOWUP_JOB_CONVERSATION_EVENT_ERROR', {
      conversation_id: conversationId,
      type,
      error: error.message,
    });
  }
}

async function sendWhatsAppTextForFollowup(phone, messageText, conversation = null) {
  const conversationId = conversation?.id || null;
  const rawPayload = {
    perseo_metadata: { response_source: 'inactivity_followup_job' },
    automation: 'inactivity_followup',
  };

  await sendPerseoAutomatedWhatsApp({
    channel: 'ia',
    to: phone,
    messages: [messageText],
    conversationId,
    rawPayload,
    policy: { allowAutomatedReply: true, reason_code: 'cron_followup', policyResolution: 'ok' },
    saveOutboundMessages: (args) => saveOutboundMessages(supabase, args),
    saveConversationEvent: saveConversationEventForJob,
    logEvent: (event, payload) => {
      console.info('FOLLOWUP_JOB_OUTBOUND', { event, ...payload });
    },
  });

  return { persistedOutbound: true };
}

router.post('/inactivity-followups', async (req, res) => {
  const startedAt = Date.now();

  if (!isFollowupsJobEnabled()) {
    return res.json({
      ok: true,
      skipped: true,
      reason: 'PERSEO_INACTIVITY_FOLLOWUPS_ENABLED=false',
    });
  }

  try {
    const limit = Number(process.env.PERSEO_FOLLOWUP_BATCH_LIMIT || req.body?.limit || 100);
    const summary = await runInactivityFollowups({
      supabase,
      sendWhatsAppText: sendWhatsAppTextForFollowup,
      limit: Number.isFinite(limit) ? limit : 100,
      logger: console,
    });

    const payload = {
      ...summary,
      duration_ms: Date.now() - startedAt,
      source: 'inactivity_followup_job',
    };

    console.info('FOLLOWUP_JOB_SUMMARY', payload);

    return res.json({ ok: true, summary: payload });
  } catch (err) {
    console.error('FOLLOWUP_JOB_FATAL', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || String(err),
    });
  }
});

module.exports = router;
