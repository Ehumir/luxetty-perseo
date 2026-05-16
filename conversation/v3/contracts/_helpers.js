'use strict';

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {string[]} errors
 * @param {string} code
 * @param {string} [detail]
 */
function pushError(errors, code, detail) {
  errors.push(detail ? `${code}:${detail}` : code);
}

/**
 * @param {string[]} errors
 * @returns {{ valid: boolean, errors: string[] }}
 */
function result(errors) {
  return { valid: errors.length === 0, errors };
}

module.exports = {
  isNonEmptyString,
  isPlainObject,
  isFiniteNumber,
  pushError,
  result,
};
