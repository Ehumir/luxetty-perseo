'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  processV3Turn,
  clearV3Session,
  composeHumanReplyText,
  CONVERSATION_GOALS,
  IDENTITY_STATES,
} = require('../conversation/v3');
const { normalizeLocationFromUserText } = require('../conversation/v3/interpreter/locationNormalizer');
const { mapV3StateToLegacyAiState } = require('../conversation/v3/state/v3ToLegacyAiState');
const { formatStateSummary } = require('../conversation/qaSprint1Commands');

function runSellScript(conversationId) {
  clearV3Session(conversationId);
    const turns = [
      'Hola',
      'Quiero vender mi casa',
      'Jorge',
      'No, está en San Pedro',
      '8 millones',
    ];
  let last;
  for (const text of turns) {
    last = processV3Turn({ conversationId, phone: '5218119086196', text });
    assert.ok(last.ok, `failed: ${text}`);
  }
  return last;
}

describe('V3-F2.1 location normalization', () => {
  it('Está en San Pedro → San Pedro', () => {
    assert.equal(normalizeLocationFromUserText('Está en San Pedro'), 'San Pedro');
    assert.equal(normalizeLocationFromUserText('esta en san pedro'), 'san pedro');
  });

  it('No, está en San Pedro → San Pedro', () => {
    assert.equal(normalizeLocationFromUserText('No, está en San Pedro'), 'San Pedro');
  });
});

describe('V3-F2.1 composer dedupe', () => {
  it('no duplica ¿Cómo te llamas? en venta sin nombre', () => {
    const reply = composeHumanReplyText({
      state: { conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY, leadFlow: 'offer', collectedFields: {} },
      decision: { detectedIntent: 'SELL_PROPERTY' },
    });
    const count = (reply.match(/cómo te llamas/gi) || []).length;
    assert.equal(count, 1, reply);
  });

  it('no duplica tipo de inmueble tras precio (SELLER_PRICE)', () => {
    const reply = composeHumanReplyText({
      state: {
        conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
        leadFlow: 'offer',
        locationText: 'San Pedro',
        expectedPrice: 8_000_000,
        collectedFields: { fullName: 'Jorge' },
      },
      decision: { detectedIntent: 'SELLER_PRICE' },
    });
    const typeQ = (reply.match(/tipo de inmueble|casa, departamento o terreno/gi) || []).length;
    assert.equal(typeQ, 1, reply);
    assert.equal((reply.match(/¿/g) || []).length, 1, reply);
  });

  it('no duplica pregunta de precio esperado', () => {
    const reply = composeHumanReplyText({
      state: {
        conversationGoal: CONVERSATION_GOALS.SELL_PROPERTY,
        leadFlow: 'offer',
        locationText: 'San Pedro',
        collectedFields: { fullName: 'Jorge' },
      },
      decision: { detectedIntent: 'LOCATION_CAPTURE' },
    });
    const count = (reply.match(/precio esperado/gi) || []).length;
    assert.equal(count, 1, reply);
  });
});

describe('V3-F2.1 state bridge + ownership', () => {
  it('guion venta: legacy projection y !state fields', () => {
    const last = runSellScript('f21-sell-1');
    const legacy = mapV3StateToLegacyAiState(last.state);

    assert.equal(legacy.lead_flow, 'offer');
    assert.equal(legacy.operation_type, 'sale');
    assert.equal(legacy.full_name, 'Jorge');
    assert.equal(legacy.location_text, 'San Pedro');
    assert.equal(legacy.conversation_goal, CONVERSATION_GOALS.SELL_PROPERTY);
    assert.equal(legacy.conversation_goal_locked, true);
    assert.equal(legacy.identity_state, IDENTITY_STATES.CONFIRMED);
    assert.equal(last.state.conversationGoalLocked, true);

    const summary = formatStateSummary({ contact_id: 'c', lead_id: 'l' }, legacy);
    assert.match(summary, /full_name: Jorge/);
    assert.match(summary, /lead_flow: offer/);
    assert.match(summary, /location_text: San Pedro/);
    assert.match(summary, /goal_locked: true/);
    assert.match(summary, /identity_state: CONFIRMED/);
    assert.match(summary, /conversation_stage:/);
  });
});
