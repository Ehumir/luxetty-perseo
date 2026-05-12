'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { generateAdvisorReply, sanitizeAdvisorOutput } = require('../conversation/openAiAdvisorResponder');

test('sanitizeAdvisorOutput elimina URL supabase', () => {
  const out = sanitizeAdvisorOutput('Te paso https://abc.supabase.co/storage/v1/object/public/x.jpg', {});
  assert.doesNotMatch(out, /supabase\.co/i);
});

test('generateAdvisorReply usa facts estructurados sin inventar', async () => {
  let called = false;
  const mock = async (payload) => {
    called = true;
    assert.equal(payload.synthetic_state.active_playbook, 'buyer_search');
    return { text: 'Perfecto, te ayudo con opciones reales en Cumbres.', used_openai_advisor: true };
  };

  const out = await generateAdvisorReply(
    {
      ai_state: { active_playbook: 'buyer_search' },
      user_message: '¿Tienen algo en Cumbres?',
      buyer_context: { location_text: 'Cumbres' },
      user: { missing_name: true },
      recent_messages: [],
    },
    { generateAdvisorReplyForRealEstateTurn: mock }
  );

  assert.equal(called, true);
  assert.match(out.text, /Cumbres/);
});
