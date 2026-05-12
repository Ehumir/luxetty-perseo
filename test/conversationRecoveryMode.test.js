'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const recovery = require('../conversation/conversationRecoveryMode');

test('shouldActivateRecoveryMode por frustración', () => {
  const on = recovery.shouldActivateRecoveryMode({
    user_message: 'ya vi que eres un bot',
    generated_reply: 'Dime qué quieres revisar de LUX-A0470',
    forbidden_phrases: ['Dime qué quieres revisar de'],
  });
  assert.equal(on, true);
});

test('buildRecoveryContext fuerza goal recovery', () => {
  const ctx = recovery.buildRecoveryContext({ conversational_goal: 'x' });
  assert.equal(ctx.conversational_goal, 'recovery_natural_reply');
  assert.equal(ctx.anti_loop_detected, true);
});

test('generateRecoveryResponse delega en advisor responder', async () => {
  const out = await recovery.generateRecoveryResponse(
    { user_message: 'hola', ai_state: {}, user: { missing_name: true }, recent_messages: [] },
    { generateAdvisorReplyForRealEstateTurn: async () => ({ text: 'Retomo bien, te apoyo.', used_openai_advisor: true }) }
  );
  assert.match(out.text, /Retomo bien/);
});
