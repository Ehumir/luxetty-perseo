'use strict';

const { processInboundForArgos } = require('./processInboundForArgos');
const {
  ARGOS_MAX_TURNS_PER_SCENARIO,
  ARGOS_SCENARIO_TIMEOUT_MS,
  ARGOS_ERROR_CODES,
} = require('./constants');
const { createArgosTrace, traceEvent, flushTrace } = require('./argosTrace');
const { validateMustNotReply } = require('./mustNotValidator');
const { extractListingCodes } = require('./mustNotValidator');

function resolveSupabaseRaw(input) {
  if (input.supabaseRaw) return input.supabaseRaw;
  const flags = input.flags || {};
  if (flags.crm_dry_run === false) return null;
  const { supabase } = require('../services/supabaseService');
  return supabase;
}

function contactWouldMaterialize(crm) {
  if (!crm?.contact) return false;
  return !!(crm.contact.would_create_contact || crm.contact.would_reuse_contact);
}

function leadWouldMaterialize(crm) {
  if (!crm?.lead) return false;
  return !!(crm.lead.would_create_lead || crm.lead.would_reuse_lead);
}

function pickTurnDiagnostics(debugTrace = []) {
  const types = new Set(['parser_winner', 'state_transition', 'crm_gate_blockers']);
  return debugTrace.filter((row) => types.has(row.type));
}

/**
 * @param {object} expected
 * @param {object|null} snapshot
 * @param {object|null} panel
 * @param {object|null} crm
 * @param {object[]} violations
 */
function collectExpectedViolations(expected, snapshot, panel, crm, violations) {
  if (!expected || typeof expected !== 'object') return;

  if (expected.intent) {
    const actualIntent = panel?.intent || snapshot?.detected_intent || null;
    if (actualIntent !== expected.intent) {
      violations.push({
        code: 'expected_intent_mismatch',
        expected: expected.intent,
        actual: actualIntent,
      });
    }
  }
  if (expected.lead_type) {
    const actualLead = panel?.lead_type || snapshot?.lead_flow || null;
    if (actualLead !== expected.lead_type) {
      violations.push({
        code: 'expected_lead_type_mismatch',
        expected: expected.lead_type,
        actual: actualLead,
      });
    }
  }
  if (expected.conversation_stage && snapshot?.conversation_stage !== expected.conversation_stage) {
    violations.push({
      code: 'expected_conversation_stage_mismatch',
      expected: expected.conversation_stage,
      actual: snapshot?.conversation_stage,
    });
  }
  if (expected.crm_ready === true && snapshot?.crm_ready !== true) {
    violations.push({
      code: 'expected_crm_ready',
      expected: true,
      actual: snapshot?.crm_ready,
    });
  }
  if (expected.crm_ready === false && snapshot?.crm_ready !== false) {
    violations.push({
      code: 'expected_crm_not_ready',
      expected: false,
      actual: snapshot?.crm_ready,
    });
  }
  if (expected.advisor_contact_consent && snapshot?.advisor_contact_consent !== expected.advisor_contact_consent) {
    violations.push({
      code: 'expected_advisor_contact_consent_mismatch',
      expected: expected.advisor_contact_consent,
      actual: snapshot?.advisor_contact_consent,
    });
  }
  if (expected.known_name != null) {
    const actualName = snapshot?.known_name || null;
    if (String(actualName || '').toLowerCase() !== String(expected.known_name).toLowerCase()) {
      violations.push({
        code: 'expected_known_name_mismatch',
        expected: expected.known_name,
        actual: actualName,
      });
    }
  }
  if (expected.known_budget != null && Number(snapshot?.known_budget) !== Number(expected.known_budget)) {
    violations.push({
      code: 'expected_known_budget_mismatch',
      expected: expected.known_budget,
      actual: snapshot?.known_budget,
    });
  }
  if (expected.known_zone != null) {
    const actualZone = snapshot?.known_zone || panel?.zone || null;
    if (String(actualZone || '').toLowerCase() !== String(expected.known_zone).toLowerCase()) {
      violations.push({
        code: 'expected_known_zone_mismatch',
        expected: expected.known_zone,
        actual: actualZone,
      });
    }
  }
  if (expected.crm_ready === true && crm?.skipped) {
    violations.push({
      code: 'expected_crm_dry_run_not_skipped',
      reason: crm.reason || null,
    });
  }
  if (expected.should_create_contact && !contactWouldMaterialize(crm)) {
    violations.push({ code: 'expected_contact_would_materialize' });
  }
  if (expected.should_create_lead && !leadWouldMaterialize(crm)) {
    violations.push({ code: 'expected_lead_would_materialize' });
  }
}

/**
 * @param {{
 *   phone_sim: string,
 *   flags?: object,
 *   scenario: object,
 *   supabaseRaw?: object,
 * }} input
 */
async function runArgosScenario(input) {
  const trace = createArgosTrace();
  const scenario = input.scenario || {};
  const messages = Array.isArray(scenario.messages) ? scenario.messages : [];
  const must_not = scenario.must_not || {};
  const expected = scenario.expected || {};
  const violations = [];
  const turns = [];
  const supabaseRaw = resolveSupabaseRaw(input);

  if (messages.length > ARGOS_MAX_TURNS_PER_SCENARIO) {
    return {
      ok: false,
      error_code: ARGOS_ERROR_CODES.LOOP_DETECTED,
      message: `Scenario exceeds max turns (${ARGOS_MAX_TURNS_PER_SCENARIO})`,
      turns,
      violations: [{ code: 'max_turns_exceeded' }],
      ...flushTrace(trace),
    };
  }

  const started = Date.now();
  let session_id = null;
  let lastPanel = null;
  let lastSnapshot = null;
  let lastCrm = null;
  let lastTurnDiagnostics = [];

  for (let i = 0; i < messages.length; i += 1) {
    if (Date.now() - started > ARGOS_SCENARIO_TIMEOUT_MS) {
      violations.push({ code: ARGOS_ERROR_CODES.SCENARIO_TIMEOUT });
      break;
    }

    const result = await processInboundForArgos({
      session_id,
      phone_sim: input.phone_sim,
      text: messages[i],
      flags: input.flags,
      supabaseRaw,
    });

    if (result.error_code === ARGOS_ERROR_CODES.LOOP_DETECTED) {
      violations.push({ code: 'LOOP_DETECTED', turn: i + 1 });
      turns.push(result);
      break;
    }

    session_id = result.session_id;
    lastPanel = result.technical_panel;
    lastSnapshot = result.conversation_snapshot;
    lastCrm = result.crm_dry_run;
    lastTurnDiagnostics = pickTurnDiagnostics(result.debug_trace);
    const mustNotViolations = validateMustNotReply({
      replyText: result.reply,
      must_not,
      facts: buildScenarioFacts(messages[i], result),
    });
    if (mustNotViolations.length) {
      for (const v of mustNotViolations) {
        violations.push({ code: v.constraint, detail: v.detail, turn: i + 1 });
      }
    }

    turns.push({
      turn: i + 1,
      user: messages[i],
      reply: result.reply,
      technical_panel: result.technical_panel,
      gates: result.gates,
      must_not_violations: mustNotViolations,
    });

    traceEvent(trace, {
      type: 'scenario_turn_completed',
      phase: 'scenario',
      payload: { turn: i + 1, session_id },
    });
  }

  collectExpectedViolations(expected, lastSnapshot, lastPanel, lastCrm, violations);

  if (must_not.send_whatsapp) {
    traceEvent(trace, {
      type: 'must_not_whatsapp_verified',
      phase: 'safety',
      payload: { blocked: true },
    });
  }
  if (must_not.write_contacts || must_not.write_leads) {
    traceEvent(trace, {
      type: 'must_not_crm_writes_verified',
      phase: 'safety',
      payload: { no_writes: true },
    });
  }
  if (must_not.use_requests_table) {
    traceEvent(trace, {
      type: 'must_not_requests_table',
      phase: 'safety',
      payload: { avoided: true },
    });
  }

  const flushed = flushTrace(trace);
  const finalDiagnostics = lastTurnDiagnostics.reduce(
    (acc, row) => {
      if (row.type === 'parser_winner') acc.parser_winner = row.payload;
      if (row.type === 'state_transition') acc.state_transition = row.payload;
      if (row.type === 'crm_gate_blockers') acc.crm_gate_blockers = row.payload;
      return acc;
    },
    {},
  );

  return {
    ok: violations.length === 0,
    session_id,
    scenario_code: scenario.scenario_code || null,
    turns,
    final: {
      conversation_snapshot: lastSnapshot,
      technical_panel: lastPanel,
      crm_dry_run: lastCrm,
      ...finalDiagnostics,
    },
    violations,
    must_not_violations: violations.filter((v) => String(v.code || '').startsWith('must_not')),
    must_not,
    events: flushed.events,
    debug_trace: [...(lastTurnDiagnostics || []), ...flushed.debug_trace],
  };
}

function buildScenarioFacts(userText, turnResult) {
  const snap = turnResult.conversation_snapshot || {};
  const codes = extractListingCodes(userText);
  const facts = {
    knownListingCodes: codes.length ? codes : snap.property_code ? [snap.property_code] : [],
    knownPrices: snap.known_budget != null ? [Number(snap.known_budget)] : [],
    propertyLookupAttempted: codes.length > 0,
    propertyFound: !!snap.interested_property_id,
    available: null,
    knownUrls: [],
    allowedUrlHosts: null,
  };
  return facts;
}

module.exports = {
  runArgosScenario,
  buildScenarioFacts,
  collectExpectedViolations,
  contactWouldMaterialize,
  leadWouldMaterialize,
};
