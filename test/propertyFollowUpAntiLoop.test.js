'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const psf = require('../conversation/propertySpecificFlow');

const ai = {
  property_code: 'LUX-A0470',
  direct_property_code: 'LUX-A0470',
  direct_property_reference: true,
  property_specific_intent: true,
};

const property = {
  id: '1',
  listing_id: 'LUX-A0470',
  neighborhood: 'Mitras Poniente',
  slug: 'casa-en-mitras',
  price: 1_000_000,
};

test('shouldAvoidRepeatedPropertyCTA cuando ya se marcó para el mismo código', () => {
  assert.equal(
    psf.shouldAvoidRepeatedPropertyCTA({ ...ai, property_generic_cta_shown_for_code: 'LUX-A0470' }, []),
    true
  );
});

test('markPropertyReplyProgress marca CTA genérico solo si el texto lo contiene', () => {
  const cta = psf.GENERIC_CTA_PHRASE;
  const patch = psf.markPropertyReplyProgress(ai, {
    intentType: 'property_follow_up_generic',
    replyText: `Claro. ${cta.charAt(0).toUpperCase()}${cta.slice(1)}`,
  });
  assert.equal(patch.property_generic_cta_shown_for_code, 'LUX-A0470');
});

test('markPropertyReplyProgress no marca CTA en intro natural sin esa frase', () => {
  const intro = psf.buildPropertyIntroReply({ property, aiState: ai, contact: null, waProfileName: null });
  const patch = psf.markPropertyReplyProgress(ai, { intentType: 'property_intro', replyText: intro });
  assert.ok(patch.property_generic_cta_shown_for_code == null);
  assert.equal(patch.property_intro_shown_for_code, 'LUX-A0470');
});

test('buildGenericPropertyFollowUpReply evita CTA literal si shouldAvoidRepeatedPropertyCTA', () => {
  const recent = [{ direction: 'outbound', message_text: `¿${psf.GENERIC_CTA_PHRASE.charAt(0).toUpperCase()}${psf.GENERIC_CTA_PHRASE.slice(1)}` }];
  const out = psf.buildPropertySpecificReply({
    intent: { type: 'property_follow_up_generic' },
    property,
    aiState: ai,
    recentMessages: recent,
    contact: null,
    waProfileName: null,
    text: 'ok',
  });
  assert.doesNotMatch(out, new RegExp(psf.GENERIC_CTA_PHRASE, 'i'));
});

test('markPropertyReplyProgress guarda follow-up pendiente para recovery', () => {
  const p = psf.markPropertyReplyProgress(ai, { intentType: 'ask_price', replyText: 'x' });
  assert.equal(p.property_pending_user_question, 'price');
});
