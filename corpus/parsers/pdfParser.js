'use strict';

/**
 * Stub — PDF ingest planned for M3+.
 * @see docs/argos/contracts/ConversationRecordV1.md
 */
function parsePdf() {
  const err = new Error('NOT_IMPLEMENTED: PdfParser — see docs/argos/contracts/ConversationRecordV1.md');
  err.code = 'NOT_IMPLEMENTED';
  throw err;
}

module.exports = { parsePdf };
