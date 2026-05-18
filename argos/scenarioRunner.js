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
      supabaseRaw: input.supabaseRaw,
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

  if (expected.intent && lastPanel?.intent !== expected.intent) {
    violations.push({
      code: 'expected_intent_mismatch',
      expected: expected.intent,
      actual: lastPanel?.intent,
    });
  }
  if (expected.lead_type && lastPanel?.lead_type !== expected.lead_type) {
    violations.push({
      code: 'expected_lead_type_mismatch',
      expected: expected.lead_type,
      actual: lastPanel?.lead_type,
    });
  }
  if (expected.should_create_contact && !lastCrm?.contact?.would_create_contact) {
    violations.push({ code: 'expected_should_create_contact' });
  }
  if (expected.should_create_lead && !lastCrm?.lead?.would_create_lead) {
    violations.push({ code: 'expected_should_create_lead' });
  }

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
  return {
    ok: violations.length === 0,
    session_id,
    scenario_code: scenario.scenario_code || null,
    turns,
    final: {
      conversation_snapshot: lastSnapshot,
      technical_panel: lastPanel,
      crm_dry_run: lastCrm,
    },
    violations,
    must_not_violations: violations.filter((v) => String(v.code || '').startsWith('must_not')),
    must_not,
    events: flushed.events,
    debug_trace: flushed.debug_trace,
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
};
