'use strict';

/**
 * Composer V3 — contrato (F1). Sin templates legacy; stub devuelve placeholders.
 * @param {{ state: object, decision: object, context?: object }} input
 * @returns {{ responseText: string, followUpQuestion: string|null, toneFlags: Record<string, boolean> }}
 */
function composeResponseStub(input) {
  const st = input.state || {};
  const d = input.decision || {};
  const intent = d.detectedIntent || 'neutral';
  return {
    responseText: `[v3-composer-stub intent=${intent}]`,
    followUpQuestion: null,
    toneFlags: { consultive: true, mexicanSpanish: true },
  };
}

module.exports = {
  composeResponseStub,
};
