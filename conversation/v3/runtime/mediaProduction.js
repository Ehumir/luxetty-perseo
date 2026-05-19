'use strict';

const { isMediaRuntimeProductionEnabled } = require('../../../config/perseoM401Flags');
const { transcribeAudio } = require('../../../services/audioTranscriptionService');
const { analyzeImage } = require('../../../services/imageVisionService');
const { cleanSpaces } = require('../../../utils/text');

/**
 * Production adapters for mediaRealBridge (Whisper / Vision / document extract).
 */

async function transcribeFromRef(media, ctx = {}) {
  if (!isMediaRuntimeProductionEnabled() && !media.force_runtime) {
    return null;
  }
  const buffer = ctx.audioBuffer || media.audio_buffer;
  const mimeType = media.mime_type || 'audio/ogg';
  if (!buffer) return { no_transcript: true, provider: 'missing_buffer' };

  const result = await transcribeAudio({
    audioBuffer: buffer,
    mimeType,
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
  });

  if (result?.status !== 'transcribed' || !cleanSpaces(result?.text || '')) {
    return { no_transcript: true, provider: result?.provider || 'transcription_empty' };
  }

  return {
    transcript: cleanSpaces(result.text),
    confidence: Number(result.confidence ?? 0.85),
    provider: result.provider || 'openai',
  };
}

async function analyzeFromRef(media, ctx = {}) {
  if (!isMediaRuntimeProductionEnabled() && !media.force_runtime) {
    return null;
  }
  const buffer = ctx.imageBuffer || media.image_buffer;
  if (!buffer) return { illegible: true, provider: 'missing_buffer' };

  const vision = await analyzeImage({
    fileBuffer: buffer,
    mimeType: media.mime_type || 'image/jpeg',
    caption: media.caption || '',
    conversationId: ctx.conversationId,
    messageId: ctx.messageId,
  });

  if (!vision?.ok) {
    return { illegible: true, provider: vision?.errorCode || 'vision_failed' };
  }

  const hints = [];
  const area = vision.propertySignals?.visibleAreaType;
  const ptype = vision.propertySignals?.probablePropertyType;
  if (area) hints.push(`área visible: ${area}`);
  if (ptype) hints.push(`tipo probable: ${ptype}`);
  if (vision.suggestedFollowUp) hints.push(cleanSpaces(vision.suggestedFollowUp));

  return {
    hints,
    confidence: Number(vision.propertySignals?.confidence ?? 0.7),
    provider: 'openai_vision',
    hints_are_non_authoritative: true,
  };
}

async function extractDocument(media) {
  if (!isMediaRuntimeProductionEnabled() && !media.force_runtime) {
    return null;
  }
  const text = cleanSpaces(media.extracted_text || media.simulate_text || '');
  if (text) {
    return { extracted_text: text, confidence: Number(media.confidence ?? 0.85), provider: media.provider || 'pre_extracted' };
  }
  return { extracted_text: null, confidence: 0, provider: 'no_extractor' };
}

function createMediaProductionAdapters(ctx = {}) {
  return {
    transcribeFn: (m) => transcribeFromRef(m, ctx),
    analyzeImageFn: (m) => analyzeFromRef(m, ctx),
    extractDocumentFn: (m) => extractDocument(m),
  };
}

module.exports = {
  transcribeFromRef,
  analyzeFromRef,
  extractDocument,
  createMediaProductionAdapters,
};
