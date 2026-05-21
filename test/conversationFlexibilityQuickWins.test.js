'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { parseMoneyAmount } = require('../conversation/v3/interpreter/moneyParser');
const { normalizeLocationFromUserText } = require('../conversation/v3/interpreter/locationNormalizer');
const { parseAdvisorContactConsent } = require('../conversation/v3/planner/consentParser');
const { parseOccupancyStatus } = require('../conversation/v3/interpreter/occupancyParser');
const { interpretUserMessage } = require('../conversation/v3/interpreter/minimalInterpreter');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');
const { V3_INTENT } = require('../conversation/v3/types/constants');
const { isConversationalFlexEnabled } = require('../config/perseoM405Flags');

const PREV_FLEX = process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED;

function withFlex(on, fn) {
  if (on) process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED = 'true';
  else delete process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED;
  try {
    fn();
  } finally {
    if (PREV_FLEX === undefined) delete process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED;
    else process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED = PREV_FLEX;
  }
}

describe('conversationFlexibilityQuickWins', () => {
  afterEach(() => {
    if (PREV_FLEX === undefined) delete process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED;
    else process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED = PREV_FLEX;
  });

  it('flag defaults OFF', () => {
    delete process.env.PERSEO_CONVERSATIONAL_FLEX_ENABLED;
    assert.equal(isConversationalFlexEnabled(), false);
  });

  it('flag OFF — slang money is no-op', () => {
    withFlex(false, () => {
      assert.equal(parseMoneyAmount('tengo 10 melones'), null);
      assert.equal(normalizeLocationFromUserText('busco en cumpres'), null);
      assert.equal(parseAdvisorContactConsent('sip'), null);
      // Legacy: substring "libre" still matches when flex OFF.
      assert.equal(parseOccupancyStatus('no está libre'), 'libre');
    });
  });

  it('flag ON — money slang MX', () => {
    withFlex(true, () => {
      assert.equal(parseMoneyAmount('10 melones'), 10_000_000);
      assert.equal(parseMoneyAmount('presupuesto 10 mdp'), 10_000_000);
      assert.equal(parseMoneyAmount('Busco casa unos 10'), 10_000_000);
      assert.equal(parseMoneyAmount('como 6 millones'), 6_000_000);
      assert.equal(parseMoneyAmount('hasta 8'), 8_000_000);
    });
  });

  it('flag ON — fuzzy zones', () => {
    withFlex(true, () => {
      assert.equal(normalizeLocationFromUserText('busco casa en cumpres'), 'Cumbres');
      assert.equal(normalizeLocationFromUserText('cunbres'), 'Cumbres');
      assert.equal(normalizeLocationFromUserText('depa en cumbres elit'), 'Cumbres Elite');
      assert.equal(normalizeLocationFromUserText('san pedro garza garca'), 'San Pedro');
    });
  });

  it('flag ON — consent MX short replies', () => {
    withFlex(true, () => {
      for (const phrase of ['sip', 'sí porfa', 'simon', 'jalo', 'me late', 'va', 'dale']) {
        assert.equal(parseAdvisorContactConsent(phrase), 'ACCEPTED', phrase);
      }
    });
  });

  it('flag ON — FLEX1 hola+busco no es GREETING; compra menu reply', () => {
    withFlex(true, () => {
      const state = createInitialConversationState({ conversationId: 'test:flex1' });
      const msg = 'Hola busco casa en cumpres elite como de unos 6 melones';
      const { patch, decision } = interpretUserMessage(state, msg);
      assert.equal(decision.detectedIntent, V3_INTENT.BUY_PROPERTY);
      assert.equal(patch.locationText, 'Cumbres Elite');
      assert.equal(patch.budget, 6_000_000);

      const state2 = createInitialConversationState({ conversationId: 'test:flex1b' });
      const menu = interpretUserMessage(state2, 'Comprar');
      assert.equal(menu.decision.detectedIntent, V3_INTENT.BUY_PROPERTY);
    });
  });

  it('flag ON — occupancy negation and variants', () => {
    withFlex(true, () => {
      assert.equal(parseOccupancyStatus('no está libre'), 'habitada');
      assert.equal(parseOccupancyStatus('no vive nadie'), 'libre');
      assert.equal(parseOccupancyStatus('está desocupada'), 'libre');
      assert.equal(parseOccupancyStatus('la tengo rentada'), 'rentada');
      assert.equal(parseOccupancyStatus('vive mi familia'), 'habitada');
    });
  });
});
