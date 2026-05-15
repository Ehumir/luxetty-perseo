'use strict';

const { composeResponseStub } = require('../composer/composerStub');

/**
 * Harness de sombra: compara salidas **ya materializadas** (legacy vs V3 mock).
 * No toca WhatsApp ni persistencia.
 * @param {{ legacyText: string, v3State: object, v3Decision: object }} input
 */
function runShadowCompare(input) {
  const v3Out = composeResponseStub({
    state: input.v3State,
    decision: input.v3Decision,
    context: {},
  });
  const legacyText = String(input.legacyText || '');
  const v3Text = [v3Out.responseText, v3Out.followUpQuestion].filter(Boolean).join('\n');
  return {
    legacySnippet: legacyText.slice(0, 400),
    v3Snippet: v3Text.slice(0, 400),
    equal: legacyText === v3Text,
    v3Structured: v3Out,
  };
}

module.exports = {
  runShadowCompare,
};
