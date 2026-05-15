'use strict';

const { getPerseoV3Config } = require('../../../config/perseoV3Flags');

const EVENTS = Object.freeze({
  STATE_TRANSITION: 'state_transition',
  DECISION: 'decision',
  RULE_BLOCK: 'rule_block',
  STAGE_CHANGE: 'stage_change',
  IDENTITY_CHANGE: 'identity_change',
});

/**
 * Logger estructurado V3. Silencioso salvo `PERSEO_V3_LOG=true` o shadow mode.
 * @param {string} event
 * @param {Record<string, unknown>} [payload]
 */
function v3Log(event, payload = {}) {
  const c = getPerseoV3Config();
  if (!c.logStructured && !c.shadowMode) return;
  const line = { tag: '[V3]', event, ...payload, ts: new Date().toISOString() };
  console.info(JSON.stringify(line));
}

module.exports = {
  v3Log,
  V3_LOG_EVENTS: EVENTS,
};
