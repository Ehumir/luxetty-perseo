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

const { processV3Turn, clearV3Session, CONVERSATION_STAGES, ADVISOR_CONTACT_CONSENT } = require('../conversation/v3');
const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');
const { formatStateSummary } = require('../conversation/qaSprint1Commands');
const { buildCrmDryRunPayload } = require('../conversation/v3/crm/payloadBuilder');
const { evaluateQualification } = require('../conversation/v3/planner/qualificationPlanner');
const { parseAdvisorContactConsent } = require('../conversation/v3/planner/consentParser');
const { isV3HandoffEnabled } = require('../config/perseoV3Flags');

describe('V3-F3.1 flags', () => {
  it('handoff enabled en tests', () => {
    assert.equal(isV3HandoffEnabled(), true);
  });
});

describe('V3-F3.1 consent parser', () => {
  it('acepta frases de contacto con asesor', () => {
    assert.equal(parseAdvisorContactConsent('Sí, que me contacte un asesor'), 'ACCEPTED');
    assert.equal(parseAdvisorContactConsent('no gracias'), 'DECLINED');
  });
});

describe('V3-F3.1 QA script venta + handoff', () => {
  it('guion oficial PASS', () => {
    const cid = 'f31-qa-sell';
    clearV3Session(cid);
    const script = [
      'Hola',
      'Quiero vender mi casa',
      'Jorge',
      'En San Pedro',
      '15 millones',
      'Libre',
      'Sí, que me contacte un asesor',
    ];
    let last;
    for (const text of script) {
      last = processV3Turn({ conversationId: cid, phone: '5218119086196', text });
      assert.ok(last.ok, text);
      assert.equal(last.responseSource, 'v3_core_f3_1', text);
    }

    assert.match(String(last.reply), /asesor de Luxetty/i);
    assert.equal(last.state.conversationGoal, 'SELL_PROPERTY');
    assert.equal(last.state.advisorContactConsent, ADVISOR_CONTACT_CONSENT.ACCEPTED);
    assert.equal(last.state.qualificationComplete, true);
    assert.equal(last.state.crmPayloadReady, true);
    assert.equal(last.state.conversationStage, CONVERSATION_STAGES.CRM_READY);

    const legacy = mapV3StateToLegacyAiState(last.state);
    assert.equal(legacy.full_name, 'Jorge');
    assert.equal(legacy.location_text, 'San Pedro');
    assert.equal(legacy.expected_price, 15_000_000);
    assert.equal(legacy.occupancy_status, 'libre');
    assert.equal(legacy.qualification_complete, true);
    assert.equal(legacy.advisor_contact_consent, 'ACCEPTED');
    assert.equal(legacy.crm_payload_ready, true);

    const payload = buildCrmDryRunPayload(last.state);
    assert.ok(payload);
    assert.equal(payload.intent, 'SELL_PROPERTY');
    assert.equal(payload.advisor_contact_consent, 'ACCEPTED');

    const summary = formatStateSummary({}, legacy);
    assert.match(summary, /advisor_contact_consent: ACCEPTED/);
    assert.match(summary, /crm_payload_ready: true/);

    const planner = evaluateQualification(last.state);
    assert.equal(planner.qualificationComplete, true);
    assert.deepEqual(planner.missingSlots, []);
  });

  it('saludo presenta asesor IA de Luxetty', () => {
    const cid = 'f31-greet';
    clearV3Session(cid);
    const r = processV3Turn({ conversationId: cid, phone: '521', text: 'Hola' });
    assert.match(String(r.reply), /asesor IA de Luxetty/i);
    assert.match(String(r.reply), /vender/i);
  });

  it('no repite occupancy tras Libre', () => {
    const cid = 'f31-no-loop';
    clearV3Session(cid);
    const script = ['Quiero vender mi casa', 'Jorge', 'En San Pedro', '15 millones', 'Libre'];
    let last;
    for (const text of script) {
      last = processV3Turn({ conversationId: cid, phone: '521', text });
    }
    const again = processV3Turn({ conversationId: cid, phone: '521', text: 'Libre' });
    assert.doesNotMatch(String(again.reply), /habitada, rentada o libre/i);
    assert.ok(
      last.state.advisorContactConsent === ADVISOR_CONTACT_CONSENT.REQUESTED ||
        last.state.handoffStage === CONVERSATION_STAGES.HANDOFF_PENDING
    );
  });
});
