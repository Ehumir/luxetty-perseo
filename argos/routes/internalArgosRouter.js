'use strict';

const express = require('express');
const { getArgosConfig } = require('../../config/argosFlags');
const { getPerseoV3Config } = require('../../config/perseoV3Flags');
const { supabase } = require('../../services/supabaseService');
const { processInboundForArgos, resetArgosV3Session } = require('../processInboundForArgos');
const { previewCrmPipeline } = require('../previewCrmPipeline');
const { runArgosScenario } = require('../scenarioRunner');
const {
  createSession,
  getSession,
  resetSession,
} = require('../argosSessionStore');
const { getSession: getV3Session } = require('../../conversation/v3/core/sessionStore');
const { buildConversationSnapshot } = require('../conversationSnapshot');
const { createArgosNoWriteSupabase } = require('../argosNoWriteSupabase');
const { createArgosTrace, traceEvent, flushTrace } = require('../argosTrace');
const { argosConversationId } = require('../processInboundForArgos');
const {
  ARGOS_MAX_TURNS_PER_SCENARIO,
  ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE,
  ARGOS_SCENARIO_TIMEOUT_MS,
  ARGOS_TURN_TIMEOUT_MS,
} = require('../constants');

const router = express.Router();

router.get('/health', (req, res) => {
  const cfg = getArgosConfig();
  const v3 = getPerseoV3Config();
  res.json({
    ok: true,
    argos_enabled: cfg.enabled,
    v3_enabled: v3.enabled,
    crm_execute: v3.crmExecute,
    crm_dry_run: v3.crmDryRun,
    environment: cfg.environment,
    openai_available: !!process.env.OPENAI_API_KEY,
    supabase_available: !!process.env.SUPABASE_URL,
    build_sha: cfg.buildSha,
    version: cfg.version,
    limits: {
      max_turns_per_scenario: ARGOS_MAX_TURNS_PER_SCENARIO,
      max_assistant_replies_consecutive: ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE,
      scenario_timeout_ms: ARGOS_SCENARIO_TIMEOUT_MS,
      turn_timeout_ms: ARGOS_TURN_TIMEOUT_MS,
    },
  });
});

router.post('/simulate-turn', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await processInboundForArgos({
      session_id: body.session_id,
      phone_sim: body.phone_sim,
      text: body.text,
      flags: body.flags || {},
      supabaseRaw: supabase,
      referral: body.referral || null,
      raw_payload: body.raw_payload || null,
    });
    if (result.error_code) {
      return res.status(409).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error('argos_simulate_turn_error', err);
    return res.status(500).json({
      ok: false,
      error_code: 'internal_error',
      message: err.message,
    });
  }
});

router.post('/crm-dry-run', async (req, res) => {
  try {
    const body = req.body || {};
    const session = body.session_id ? getSession(body.session_id) : null;
    const conversationId = body.session_id ? argosConversationId(body.session_id) : null;
    const v3State = body.v3_state || (conversationId ? getV3Session(conversationId) : null);

    if (!v3State) {
      return res.json({
        session_id: body.session_id || null,
        conversation_snapshot: null,
        crm_dry_run: {
          skipped: true,
          reason: 'no_v3_state',
          errors: [],
          warnings: [],
        },
        events: [{ type: 'crm_dry_run_requested' }],
        debug_trace: [],
      });
    }

    const trace = createArgosTrace();
    traceEvent(trace, { type: 'crm_dry_run_requested', phase: 'crm_preview' });

    const wrapped = createArgosNoWriteSupabase(supabase);
    const crm_dry_run = await previewCrmPipeline({
      v3State,
      phone_sim: body.phone_sim || session?.phone_sim,
      sessionMeta: session || {},
      supabase: wrapped,
      trace,
    });

    const flushed = flushTrace(trace);
    return res.json({
      session_id: body.session_id || null,
      conversation_snapshot: buildConversationSnapshot(v3State, session?.legacy_ai_state),
      crm_dry_run,
      events: [{ type: 'crm_dry_run_requested' }, ...flushed.events],
      debug_trace: flushed.debug_trace,
    });
  } catch (err) {
    if (err.code === 'ARGOS_SIDE_EFFECT_BLOCKED') {
      return res.status(409).json({
        ok: false,
        error_code: err.code,
        message: err.message,
        argos_blocked: err.argos_blocked,
      });
    }
    console.error('argos_crm_dry_run_error', err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

router.post('/reset-session', (req, res) => {
  const body = req.body || {};
  const session = body.session_id ? getSession(body.session_id) : null;
  if (!session) {
    return res.status(404).json({
      ok: false,
      error_code: 'session_not_found',
      message: 'session_not_found',
    });
  }

  const mode = body.mode === 'full' ? 'full' : 'crm';
  resetSession(body.session_id, { mode });
  if (mode === 'full') {
    resetArgosV3Session(body.session_id);
  }

  const trace = createArgosTrace();
  traceEvent(trace, {
    type: mode === 'crm' ? 'qa_crm_reset_completed' : 'argos_session_reset_full',
    phase: 'crm_preview',
    payload: { mode },
  });
  if (mode === 'crm') {
    traceEvent(trace, {
      type: 'qa_crm_force_new_lead',
      phase: 'crm_preview',
      visibility: 'debug',
      payload: { value: true },
    });
  }

  const conversationId = argosConversationId(body.session_id);
  const v3State = getV3Session(conversationId);
  const flushed = flushTrace(trace);

  return res.json({
    session_id: body.session_id,
    ok: true,
    mode,
    conversation_snapshot: buildConversationSnapshot(v3State, session.legacy_ai_state),
    events: flushed.events,
    debug_trace: flushed.debug_trace,
  });
});

router.post('/run-scenario', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runArgosScenario({
      phone_sim: body.phone_sim,
      flags: body.flags || {},
      scenario: body.scenario || {},
      supabaseRaw: supabase,
    });
    return res.json(result);
  } catch (err) {
    console.error('argos_run_scenario_error', err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
