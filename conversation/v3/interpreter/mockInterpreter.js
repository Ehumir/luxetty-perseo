'use strict';

const { interpretUserMessage } = require('./minimalInterpreter');

/** Alias retrocompatible (F1 tests). */
function interpretUserTextMock(state, text) {
  return interpretUserMessage(state, text);
}

module.exports = {
  interpretUserTextMock,
  interpretUserMessage,
};
