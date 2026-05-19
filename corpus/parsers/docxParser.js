'use strict';

/**
 * Stub — DOCX ingest planned for M3+.
 * @see docs/argos/contracts/ConversationRecordV1.md
 */
function parseDocx() {
  const err = new Error('NOT_IMPLEMENTED: DocxParser — see docs/argos/contracts/ConversationRecordV1.md');
  err.code = 'NOT_IMPLEMENTED';
  throw err;
}

module.exports = { parseDocx };
