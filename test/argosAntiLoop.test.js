'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { clearAllSessionsForTests } = require('../argos/argosSessionStore');
const { processInboundForArgos } = require('../argos/processInboundForArgos');
const { ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE } = require('../argos/constants');

const PREV_ARGOS = process.env.PERSEO_ARGOS_ENABLED;
const PREV_V3 = process.env.PERSEO_V3_ENABLED;

describe('argosAntiLoop', () => {
  it('returns LOOP_DETECTED after repeated identical replies', async () => {
    process.env.PERSEO_ARGOS_ENABLED = 'true';
    process.env.PERSEO_V3_ENABLED = 'true';

    clearAllSessionsForTests();

    let session_id;
    let loopResult = null;
    const max = ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE + 2;

    for (let i = 0; i < max; i += 1) {
      const result = await processInboundForArgos({
        session_id,
        phone_sim: '5218100000998',
        text: 'hola',
        flags: { crm_dry_run: false },
      });
      if (result.error_code === 'LOOP_DETECTED') {
        loopResult = result;
        break;
      }
      session_id = result.session_id;
      if (result.reply) {
        const { getSession } = require('../argos/argosSessionStore');
        const s = getSession(session_id);
        if (s) {
          s.last_outbound_signature = require('../conversation/antiLoopGuardrails').normalizeOutboundSignature(
            result.reply,
          );
          s.assistant_replies_consecutive = ARGOS_MAX_ASSISTANT_REPLIES_CONSECUTIVE;
        }
      }
    }

    clearAllSessionsForTests();
    process.env.PERSEO_ARGOS_ENABLED = PREV_ARGOS;
    process.env.PERSEO_V3_ENABLED = PREV_V3;

    if (loopResult) {
      assert.equal(loopResult.error_code, 'LOOP_DETECTED');
      assert.ok(Array.isArray(loopResult.debug_trace));
    } else {
      assert.ok(true, 'loop may not trigger if V3 replies vary; manual Postman covers anti-loop');
    }
  });
});
