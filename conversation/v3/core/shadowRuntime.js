'use strict';

const { processV3Turn } = require('./v3Runtime');
const { v3Log } = require('./v3Logger');

/**
 * Ejecuta V3 en sombra sin cambiar la respuesta al usuario.
 * @param {{ conversationId: string, phone?: string, text: string, legacyReply: string| string[] }} input
 */
function runV3ShadowPass(input) {
  const legacyText = Array.isArray(input.legacyReply)
    ? input.legacyReply.map((s) => String(s || '').trim()).filter(Boolean).join('\n\n')
    : String(input.legacyReply || '');

  let shadow;
  try {
    shadow = processV3Turn({
      conversationId: input.conversationId,
      phone: input.phone,
      text: input.text,
    });
  } catch (err) {
    v3Log('shadow_error', {
      conversation_id: input.conversationId,
      error: String(err?.message || err),
    });
    return { ok: false, error: String(err?.message || err) };
  }

  const v3Text = shadow.ok ? String(shadow.reply || '') : '';
  const equal = legacyText.trim() === v3Text.trim();

  v3Log('shadow_diff', {
    conversation_id: input.conversationId,
    equal,
    legacy_snippet: legacyText.slice(0, 280),
    v3_snippet: v3Text.slice(0, 280),
    v3_stage: shadow.state?.conversationStage,
    v3_goal: shadow.state?.conversationGoal,
    v3_intent: shadow.decision?.detectedIntent,
  });

  return {
    ok: true,
    equal,
    legacySnippet: legacyText.slice(0, 400),
    v3Snippet: v3Text.slice(0, 400),
    shadow,
  };
}

module.exports = {
  runV3ShadowPass,
};
