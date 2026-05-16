'use strict';

const { composeResponseStub } = require('../composer/composerStub');
const { isPlainObject, pushError, result } = require('./_helpers');

/**
 * @param {unknown} output
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateComposerOutput(output) {
  const errors = [];
  if (!isPlainObject(output)) {
    pushError(errors, 'composer_output_not_object');
    return result(errors);
  }
  if (typeof output.responseText !== 'string') {
    pushError(errors, 'response_text_not_string');
  } else if (!output.responseText.trim()) {
    pushError(errors, 'response_text_empty');
  }
  if (output.followUpQuestion != null && typeof output.followUpQuestion !== 'string') {
    pushError(errors, 'follow_up_question_not_string');
  }
  if (!isPlainObject(output.toneFlags)) {
    pushError(errors, 'tone_flags_not_object');
  }
  return result(errors);
}

/**
 * @param {{ state: object, decision: object, context?: object }} input
 * @returns {{ valid: boolean, errors: string[], output: object }}
 */
function runComposerContract(input) {
  const output = composeResponseStub(input);
  const shape = validateComposerOutput(output);
  return { ...shape, output };
}

module.exports = {
  validateComposerOutput,
  runComposerContract,
  composeResponseStub,
};
