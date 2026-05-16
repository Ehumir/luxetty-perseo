'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const PREV_HANDOFF = process.env.PERSEO_V3_HANDOFF_ENABLED;
const PREV_CRM = process.env.PERSEO_V3_CRM_DRY_RUN;

before(() => {
  process.env.PERSEO_V3_HANDOFF_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_DRY_RUN = 'true';
});

after(() => {
  if (PREV_HANDOFF === undefined) delete process.env.PERSEO_V3_HANDOFF_ENABLED;
  else process.env.PERSEO_V3_HANDOFF_ENABLED = PREV_HANDOFF;
  if (PREV_CRM === undefined) delete process.env.PERSEO_V3_CRM_DRY_RUN;
  else process.env.PERSEO_V3_CRM_DRY_RUN = PREV_CRM;
});

const { FORCED_HANDOFF_REASONS } = require('../conversation/v3/types/forcedHandoffReasons');
const { forceHandoff } = require('../conversation/v3/planner/handoffPlanner');
const { detectForcedHandoffReason } = require('../conversation/v3/planner/forcedHandoffDetector');
const {
  composeForcedHandoffFallback,
  assertForcedHandoffQuality,
} = require('../conversation/v3/composer/forcedHandoffComposer');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');
const { createEmptyDecision } = require('../conversation/v3/types/conversationDecision');
const {
  processV3Turn,
  clearV3Session,
  CONVERSATION_STAGES,
  CONVERSATION_GOALS,
  V3_INTENT,
} = require('../conversation/v3');
const { evaluateV3PrimaryGate } = require('../config/perseoV3Flags');
const { buildForcedHandoffFromSession, runForcedHandoffTurn } = require('../conversation/v3/core/forcedHandoffTurn');
const { setSession } = require('../conversation/v3/core/sessionStore');
const { mergeConversationState } = require('../conversation/v3/types/conversationState');
const { evaluateRuleGuard } = require('../conversation/v3/rules/ruleGuard');

const REQUIRED_COPY = /\b(asesor|asesora)\b/i;
const CANALIZE = /\b(canalizar|canalizaci[oó]n)\b/i;
const CONTACT = /\b(contactar[aá]|escribir[aá]|seguimiento)\b/i;

function assertForcedCopy(text, label) {
  assert.match(String(text), REQUIRED_COPY, label);
  assert.match(String(text), CANALIZE, label);
  assert.match(String(text), CONTACT, label);
  assert.doesNotMatch(String(text), /\b(disponible\s+confirmad|precio\s+es\s+de)\b/i, label);
}

describe('V3-F3.3B forced handoff composer', () => {
  for (const reason of Object.values(FORCED_HANDOFF_REASONS)) {
    it(`reason ${reason} produces mandatory copy`, () => {
      const state = createInitialConversationState({
        conversationId: 'f33b-copy',
        phone: '5218119086196',
      });
      state.collectedFields = { fullName: 'Laura' };
      const out = composeForcedHandoffFallback(state, reason);
      assert.equal(assertForcedHandoffQuality(out.responseText), true);
      assertForcedCopy(out.responseText, reason);
    });
  }
});

describe('V3-F3.3B forceHandoff state', () => {
  it('sets unhandledReason and HANDOFF_PENDING when consent unknown', () => {
    const state = createInitialConversationState({ conversationId: 'f33b-st' });
    const { patch, action } = forceHandoff(state, {
      reason: FORCED_HANDOFF_REASONS.INTENT_UNKNOWN,
    });
    assert.equal(action, 'FORCE_HANDOFF');
    assert.equal(patch.unhandledReason, 'intent_unknown');
    assert.equal(patch.handoffReason, 'intent_unknown');
    assert.equal(patch.conversationStage, CONVERSATION_STAGES.HANDOFF_PENDING);
  });

  it('uses HANDOFF_READY when consent already accepted', () => {
    const state = createInitialConversationState({ conversationId: 'f33b-ready' });
    state.advisorContactConsent = 'ACCEPTED';
    const { patch, action } = forceHandoff(state, {
      reason: FORCED_HANDOFF_REASONS.RUNTIME_ERROR,
    });
    assert.equal(action, 'FORCE_HANDOFF_READY');
    assert.equal(patch.conversationStage, CONVERSATION_STAGES.HANDOFF_READY);
  });
});

describe('V3-F3.3B detectors', () => {
  it('detects user_requests_human and media_unsupported', () => {
    const state = createInitialConversationState({});
    const d = createEmptyDecision();
    assert.equal(
      detectForcedHandoffReason({ state, decision: d, text: '¿Eres bot?' }),
      FORCED_HANDOFF_REASONS.USER_REQUESTS_HUMAN
    );
    assert.equal(
      detectForcedHandoffReason({ state, decision: d, text: 'Te mandé un audio' }),
      FORCED_HANDOFF_REASONS.MEDIA_UNSUPPORTED
    );
  });

  it('detects rule_guard_violation from guard object', () => {
    const state = createInitialConversationState({});
    const d = createEmptyDecision();
    const reason = detectForcedHandoffReason({
      state,
      decision: d,
      text: 'ok',
      guard: { allowed: false, violations: ['x'] },
    });
    assert.equal(reason, FORCED_HANDOFF_REASONS.RULE_GUARD_VIOLATION);
  });
});

describe('V3-F3.3B runtime — no silent legacy on primary path', () => {
  it('rule_guard_violation uses forced handoff instead of silent legacy', () => {
    let state = createInitialConversationState({ conversationId: 'f33b-guard' });
    state = mergeConversationState(state, {
      conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
      leadFlow: 'offer',
      conversationGoalLocked: true,
      collectedFields: { fullName: 'Jorge' },
    });
    const decision = createEmptyDecision();
    decision.detectedIntent = V3_INTENT.BUY_PROPERTY;
    decision.explicitFlowSwitch = false;
    const guard = evaluateRuleGuard(state, decision, {});
    assert.equal(guard.allowed, false);

    const forced = runForcedHandoffTurn({
      state,
      decision,
      reason: FORCED_HANDOFF_REASONS.RULE_GUARD_VIOLATION,
    });
    assertForcedCopy(forced.replyText, 'rule_guard');
    assert.equal(forced.state.unhandledReason, 'rule_guard_violation');
    assert.equal(forced.state.crmPayloadReady, false);
  });

  it('user_requests_human triggers forced handoff', () => {
    const cid = 'f33b-human';
    clearV3Session(cid);
    const r = processV3Turn({
      conversationId: cid,
      phone: '5218119086196',
      text: 'Quiero hablar con una persona real',
    });
    assert.equal(r.ok, true);
    assert.equal(r.fallbackToLegacy, false);
    assertForcedCopy(r.reply, 'human');
    assert.equal(r.forcedHandoffReason, FORCED_HANDOFF_REASONS.USER_REQUESTS_HUMAN);
  });

  it('buildForcedHandoffFromSession handles runtime_error', () => {
    const cid = 'f33b-runtime';
    clearV3Session(cid);
    const out = buildForcedHandoffFromSession({
      conversationId: cid,
      phone: '5218119086196',
      reason: FORCED_HANDOFF_REASONS.RUNTIME_ERROR,
    });
    assertForcedCopy(out.replyText, 'runtime');
    assert.equal(out.state.handoffReason, 'runtime_error');
    assert.equal(out.state.crmPayloadReady, false);
  });
});

describe('V3-F3.3B legacy isolation when V3 disabled', () => {
  it('evaluateV3PrimaryGate blocks when PERSEO_V3_ENABLED=false', () => {
    const prev = process.env.PERSEO_V3_ENABLED;
    const prevList = process.env.PERSEO_V3_QA_ALLOWLIST;
    process.env.PERSEO_V3_ENABLED = 'false';
    process.env.PERSEO_V3_QA_ALLOWLIST = '';
    try {
      const gate = evaluateV3PrimaryGate({ phone: '5218119086196' });
      assert.equal(gate.v3_primary_allowed, false);
    } finally {
      if (prev === undefined) delete process.env.PERSEO_V3_ENABLED;
      else process.env.PERSEO_V3_ENABLED = prev;
      if (prevList === undefined) delete process.env.PERSEO_V3_QA_ALLOWLIST;
      else process.env.PERSEO_V3_QA_ALLOWLIST = prevList;
    }
  });
});
