'use strict';

const { cleanSpaces } = require('../utils/text');

/**
 * Normaliza un turno de escenario ARGOS (string o objeto media).
 * @param {string|object} raw
 * @returns {{ text: string, media: object|null }}
 */
function normalizeScenarioTurn(raw) {
  if (typeof raw === 'string') {
    return { text: raw, media: null };
  }
  if (!raw || typeof raw !== 'object') {
    return { text: '', media: null };
  }

  const type = raw.type || raw.media;
  if (type === 'audio') {
    return {
      text: cleanSpaces(raw.text || raw.caption || ''),
      media: {
        kind: 'audio',
        transcript: cleanSpaces(raw.transcript || ''),
        confidence: raw.confidence != null ? Number(raw.confidence) : undefined,
        no_transcript: raw.no_transcript === true,
      },
    };
  }

  if (type === 'image') {
    return {
      text: cleanSpaces(raw.text || raw.caption || ''),
      media: {
        kind: 'image',
        hints: Array.isArray(raw.hints) ? raw.hints : [],
        caption: cleanSpaces(raw.caption || ''),
        illegible: raw.illegible === true,
      },
    };
  }

  return { text: cleanSpaces(raw.text || JSON.stringify(raw)), media: null };
}

module.exports = { normalizeScenarioTurn };
