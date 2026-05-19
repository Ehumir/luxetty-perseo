'use strict';

const RECORD_SCHEMA_VERSION = '1.0';

const VALID_ROLES = new Set(['user', 'assistant', 'system', 'tool']);

const PROMOTION_STATUSES = new Set([
  'indexed',
  'candidate',
  'promoted',
  'rejected',
  'wont_automate',
]);

const SOURCE_FORMATS = new Set(['md', 'txt', 'csv', 'json', 'docx', 'pdf']);

module.exports = {
  RECORD_SCHEMA_VERSION,
  VALID_ROLES,
  PROMOTION_STATUSES,
  SOURCE_FORMATS,
};
