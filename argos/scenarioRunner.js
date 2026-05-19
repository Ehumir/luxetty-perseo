'use strict';

const { processInboundForArgos } = require('./processInboundForArgos');
const {
  ARGOS_MAX_TURNS_PER_SCENARIO,
  ARGOS_SCENARIO_TIMEOUT_MS,
  ARGOS_ERROR_CODES,
} = require('./constants');
const { createArgosTrace, traceEvent, flushTrace } = require('./argosTrace');
const {
  validateMustNotReply,
  extractListingCodes,
  extractMoneyMentions,
  replySignature,
  questionSignature,
} = require('./mustNotValidator');
const { getPropertyFixture } = require('./propertyFixtures');
const { parseSprint1StrictCommand } = require('../conversation/qaSprint1Commands');
const { isSoftTopicDismissal } = require('../conversation/v3/interpreter/topicPivotSignals');
const { isSaleUrgencyEmotional } = require('../conversation/v3/interpreter/objectionClassifier');

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
  const types = new Set([
    'parser_winner',
    'state_transition',
    'crm_gate_blockers',
    'policy_decision',
    'segments',
    'response_plan',
  ]);
  return debugTrace.filter((row) => types.has(row.type));
}

/**
 * @param {object} expected
 * @param {object|null} snapshot
 * @param {object|null} panel
 * @param {object|null} crm
 * @param {object[]} violations
 */
function collectExpectedViolations(expected, snapshot, panel, crm, violations, turns = []) {
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
  if (expected.lead_flow) {
    const actualLeadFlow = snapshot?.lead_flow || panel?.lead_type || null;
    if (actualLeadFlow !== expected.lead_flow) {
      violations.push({
        code: 'expected_lead_flow_mismatch',
        expected: expected.lead_flow,
        actual: actualLeadFlow,
      });
    }
  }
  if (expected.operation_type && snapshot?.operation_type !== expected.operation_type) {
    violations.push({
      code: 'expected_operation_type_mismatch',
      expected: expected.operation_type,
      actual: snapshot?.operation_type ?? null,
    });
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
  if (expected.property_code != null) {
    const actualCode = snapshot?.property_code || null;
    if (String(actualCode || '').toUpperCase() !== String(expected.property_code).toUpperCase()) {
      violations.push({
        code: 'expected_property_code_mismatch',
        expected: expected.property_code,
        actual: actualCode,
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
  if (expected.loop_detected === true) {
    const loopHit = (turns || []).some((t) => t.error_code === ARGOS_ERROR_CODES.LOOP_DETECTED);
    if (!loopHit) violations.push({ code: 'expected_loop_not_detected' });
  }
  if (expected.policy_decision) {
    const actual =
      snapshot?.policy_decision ||
      (turns.length && turns[turns.length - 1].conversation_snapshot?.policy_decision) ||
      null;
    if (actual !== expected.policy_decision) {
      violations.push({
        code: 'expected_policy_decision_mismatch',
        expected: expected.policy_decision,
        actual,
      });
    }
  }
  if (expected.policy_rule_id) {
    const actual =
      snapshot?.policy_rule_id ||
      (turns.length && turns[turns.length - 1].conversation_snapshot?.policy_rule_id) ||
      null;
    if (actual !== expected.policy_rule_id) {
      violations.push({
        code: 'expected_policy_rule_id_mismatch',
        expected: expected.policy_rule_id,
        actual,
      });
    }
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
  let previousReplySignature = null;
  let previousQuestionSignature = null;
  let anchorLeadFlow = null;
  let sessionResetAtTurn = null;
  let preResetSnapshot = null;

  for (let i = 0; i < messages.length; i += 1) {
    if (Date.now() - started > ARGOS_SCENARIO_TIMEOUT_MS) {
      violations.push({ code: ARGOS_ERROR_CODES.SCENARIO_TIMEOUT });
      break;
    }

    if (parseSprint1StrictCommand(messages[i]) === 'reset') {
      sessionResetAtTurn = i + 1;
      preResetSnapshot = lastSnapshot;
    }

    const result = await processInboundForArgos({
      session_id,
      phone_sim: input.phone_sim,
      text: messages[i],
      flags: input.flags,
      supabaseRaw,
      scenarioSetup: scenario.setup,
    });

    if (result.error_code === ARGOS_ERROR_CODES.LOOP_DETECTED) {
      if (expected.loop_detected !== true) {
        violations.push({ code: 'LOOP_DETECTED', turn: i + 1 });
      }
      turns.push(result);
      break;
    }

    session_id = result.session_id;
    lastPanel = result.technical_panel;
    lastSnapshot = result.conversation_snapshot;
    lastCrm = result.crm_dry_run;
    lastTurnDiagnostics = pickTurnDiagnostics(result.debug_trace);
    const snap = result.conversation_snapshot || {};
    if (i === 2 && snap.lead_flow) anchorLeadFlow = snap.lead_flow;
    const facts = buildScenarioFacts(messages[i], result, scenario.setup);
    facts.previousReplySignature = previousReplySignature;
    facts.previousQuestionSignature = previousQuestionSignature;
    facts.suppressGlobalMenu = Boolean(snap.lead_flow) && i >= 2;
    facts.stickyLeadFlow = anchorLeadFlow;
    facts.leadFlow = snap.lead_flow || null;
    facts.explicitFlowSwitch = !!(
      result.debug_trace &&
      result.debug_trace.find((row) => row.type === 'parser_winner')?.payload?.explicit_flow_switch
    );
    facts.turnIndex = i + 1;
    facts.sessionResetAtTurn = sessionResetAtTurn;
    if (isSoftTopicDismissal(messages[i]) && lastSnapshot?.known_name) {
      facts.hadKnownNameBeforeDismissal = true;
    }
    facts.preResetZones = preResetSnapshot?.known_zone ? [String(preResetSnapshot.known_zone)] : [];
    facts.preResetBudgets =
      preResetSnapshot?.known_budget != null ? [Number(preResetSnapshot.known_budget)] : [];

    const mustNotViolations = validateMustNotReply({
      replyText: result.reply,
      must_not,
      facts,
    });
    previousReplySignature = replySignature(result.reply);
    previousQuestionSignature = questionSignature(result.reply);
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

    collectExpectedViolations(expected, lastSnapshot, lastPanel, lastCrm, violations, turns);

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
    conversation_snapshot: lastSnapshot,
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

function isCurtUserMessage(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!t) return false;
  if (t.length <= 28) return true;
  return /\bsolo\s+dime\b|\bsolo\s+precio\b|^(ok|no|si|sí|vale|va)$/.test(t);
}

function buildScenarioFacts(userText, turnResult, scenarioSetup = null) {
  const snap = turnResult?.conversation_snapshot || {};
  const codes = extractListingCodes(userText);
  const histCodes = Array.isArray(snap.property_history) ? snap.property_history : [];
  const activeCode = snap.property_code || null;
  const fixture = activeCode ? getPropertyFixture(activeCode) : null;
  const fixturePrices = [];
  const fixtureUrls = [];
  if (fixture) {
    if (fixture.price != null) fixturePrices.push(Number(fixture.price));
    if (fixture.price_label) {
      for (const n of extractMoneyMentions(fixture.price_label)) fixturePrices.push(n);
    }
    if (fixture.public_url) fixtureUrls.push(fixture.public_url);
  }
  const facts = {
    knownListingCodes: codes.length
      ? codes
      : snap.property_code
        ? [snap.property_code, ...histCodes]
        : histCodes,
    activePropertyCode: activeCode,
    userMentionedCodes: codes,
    knownPrices: fixturePrices.length ? fixturePrices : snap.known_budget != null ? [Number(snap.known_budget)] : [],
    known_zone: snap.known_zone || null,
    known_name: snap.known_name || null,
    known_budget: snap.known_budget != null ? Number(snap.known_budget) : null,
    propertyLookupAttempted: codes.length > 0 || !!activeCode,
    propertyFound: !!snap.interested_property_id,
    available: fixture?.is_active === false ? false : fixture ? true : null,
    knownUrls: fixtureUrls,
    allowedUrlHosts: null,
    qualificationIncomplete:
      snap.lead_flow === 'demand' &&
      snap.operation_type === 'sale' &&
      (!snap.known_name || !snap.known_zone || snap.known_budget == null),
    valuationRequested: snap.valuation_requested === true,
    priceUnknown: snap.price_unknown === true,
    userTurnWasCurt: isCurtUserMessage(userText),
    userExpressedUrgency: isSaleUrgencyEmotional(userText),
    userSoftTopicDismissal: isSoftTopicDismissal(userText),
    hadKnownNameBeforeDismissal: false,
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
