const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { openai } = require('./openaiService');
const { cleanSpaces } = require('../utils/text');

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
]);

const MIME_EXTENSION = {
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
};

function normalizeMimeType(mimeType = '') {
  return cleanSpaces(String(mimeType || '').toLowerCase());
}

function clampConfidence(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

function estimateConfidence(response = {}, transcriptionText = '') {
  if (response?.confidence != null) {
    return clampConfidence(response.confidence);
  }

  const segments = Array.isArray(response?.segments) ? response.segments : [];
  if (segments.length > 0) {
    const values = segments
      .map((segment) => Number(segment?.avg_logprob))
      .filter((value) => !Number.isNaN(value));

    if (values.length > 0) {
      const avgLogprob = values.reduce((acc, cur) => acc + cur, 0) / values.length;
      const confidence = 1 / (1 + Math.exp(-avgLogprob));
      return clampConfidence(confidence);
    }
  }

  if (transcriptionText.length > 120) return 0.8;
  if (transcriptionText.length > 40) return 0.7;
  if (transcriptionText.length > 15) return 0.55;
  return 0.35;
}

function buildTempPath({ mediaId, mimeType }) {
  const extension = MIME_EXTENSION[mimeType] || 'audio';
  const random = crypto.randomBytes(6).toString('hex');
  const safeMediaId = cleanSpaces(String(mediaId || 'unknown_media')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `perseo_${safeMediaId}_${random}.${extension}`;
  return path.join(os.tmpdir(), filename);
}

function makeFailure(overrides = {}) {
  return {
    success: false,
    status: 'failed',
    provider: 'openai',
    model: null,
    transcription_text: null,
    confidence_score: 0,
    language: null,
    duration_seconds: null,
    is_partial: true,
    needs_confirmation: true,
    error_code: null,
    error_message: null,
    transcribed_at: null,
    trace: null,
    ...overrides,
  };
}

async function transcribeAudio({
  fileBuffer,
  mimeType,
  filename,
  mediaId,
  conversationId,
  messageId,
  provider = 'openai',
  model,
  transcriber,
} = {}) {
  const normalizedMimeType = normalizeMimeType(mimeType);

  if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || fileBuffer.byteLength === 0) {
    return makeFailure({
      error_code: 'audio_file_buffer_missing',
      error_message: 'Audio buffer is required for transcription',
      status: 'failed_download_or_empty',
    });
  }

  if (!ALLOWED_AUDIO_MIME_TYPES.has(normalizedMimeType)) {
    return makeFailure({
      error_code: 'unsupported_audio_mime_type',
      error_message: 'Audio mime type is not enabled for transcription in Sprint 4B',
      status: 'skipped_unsupported_mime',
    });
  }

  if (provider !== 'openai') {
    return makeFailure({
      error_code: 'unsupported_transcription_provider',
      error_message: `Provider not supported: ${provider}`,
      status: 'failed',
    });
  }

  const selectedModel = cleanSpaces(model || process.env.OPENAI_AUDIO_TRANSCRIPTION_MODEL || '') || 'gpt-4o-mini-transcribe';
  const tempPath = buildTempPath({ mediaId, mimeType: normalizedMimeType });

  try {
    fs.writeFileSync(tempPath, fileBuffer);

    let response;

    if (typeof transcriber === 'function') {
      response = await transcriber({
        filePath: tempPath,
        mimeType: normalizedMimeType,
        filename: filename || path.basename(tempPath),
        model: selectedModel,
      });
    } else {
      response = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: selectedModel,
        language: 'es',
        response_format: 'verbose_json',
      });
    }

    const transcriptionText = cleanSpaces(response?.text || response?.transcript || '');

    if (!transcriptionText) {
      return makeFailure({
        provider,
        model: selectedModel,
        error_code: 'empty_transcription',
        error_message: 'Transcription completed without usable text',
        status: 'failed',
        trace: {
          media_id: mediaId || null,
          message_id: messageId || null,
          conversation_id: conversationId || null,
        },
      });
    }

    const confidence = estimateConfidence(response, transcriptionText);
    const needsConfirmation = confidence < 0.55;

    return {
      success: true,
      status: 'transcribed',
      provider,
      model: selectedModel,
      transcription_text: transcriptionText,
      confidence_score: confidence,
      language: cleanSpaces(response?.language || '') || 'es',
      duration_seconds: Number(response?.duration || 0) || null,
      is_partial: needsConfirmation,
      needs_confirmation: needsConfirmation,
      error_code: null,
      error_message: null,
      transcribed_at: new Date().toISOString(),
      trace: {
        media_id: mediaId || null,
        message_id: messageId || null,
        conversation_id: conversationId || null,
        mime_type: normalizedMimeType,
      },
    };
  } catch (error) {
    return makeFailure({
      provider,
      model: selectedModel,
      error_code: error?.code || 'audio_transcription_failed',
      error_message: error?.message || 'Unknown transcription failure',
      status: 'failed',
      trace: {
        media_id: mediaId || null,
        message_id: messageId || null,
        conversation_id: conversationId || null,
        mime_type: normalizedMimeType,
      },
    });
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (_cleanupError) {
      // best effort cleanup
    }
  }
}

module.exports = {
  ALLOWED_AUDIO_MIME_TYPES,
  transcribeAudio,
};
