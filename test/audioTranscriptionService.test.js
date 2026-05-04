const test = require('node:test');
const assert = require('node:assert/strict');

const {
  transcribeAudio,
  ALLOWED_AUDIO_MIME_TYPES,
} = require('../services/audioTranscriptionService');

test('transcribeAudio success returns transcription with confidence', async () => {
  const result = await transcribeAudio({
    fileBuffer: Buffer.from('fake-audio-binary'),
    mimeType: 'audio/ogg',
    filename: 'voice.ogg',
    mediaId: 'aud-1',
    conversationId: 'conv-1',
    messageId: 'wamid.1',
    transcriber: async () => ({
      text: 'quiero vender mi casa en cumbres',
      language: 'es',
      duration: 4.2,
      confidence: 0.88,
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'transcribed');
  assert.equal(result.transcription_text, 'quiero vender mi casa en cumbres');
  assert.equal(result.needs_confirmation, false);
  assert.equal(result.language, 'es');
});

test('transcribeAudio low confidence marks needs_confirmation', async () => {
  const result = await transcribeAudio({
    fileBuffer: Buffer.from('fake-audio-binary'),
    mimeType: 'audio/aac',
    mediaId: 'aud-2',
    transcriber: async () => ({
      text: 'venta casa',
      confidence: 0.32,
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.needs_confirmation, true);
  assert.equal(result.is_partial, true);
});

test('transcribeAudio rejects unsupported mime type', async () => {
  assert.equal(ALLOWED_AUDIO_MIME_TYPES.has('video/mp4'), false);

  const result = await transcribeAudio({
    fileBuffer: Buffer.from('fake-media'),
    mimeType: 'video/mp4',
    mediaId: 'vid-1',
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'skipped_unsupported_mime');
});

test('transcribeAudio handles provider failure transparently', async () => {
  const result = await transcribeAudio({
    fileBuffer: Buffer.from('fake-audio-binary'),
    mimeType: 'audio/mp4',
    mediaId: 'aud-3',
    transcriber: async () => {
      throw Object.assign(new Error('provider timeout'), { code: 'provider_timeout' });
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.error_code, 'provider_timeout');
});

test('transcribeAudio accepts mime type with codec parameters', async () => {
  const result = await transcribeAudio({
    fileBuffer: Buffer.from('fake-audio-binary'),
    mimeType: 'audio/ogg; codecs=opus',
    mediaId: 'aud-4',
    transcriber: async () => ({
      text: 'quiero vender mi casa',
      confidence: 0.8,
      language: 'es',
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.status, 'transcribed');
  assert.equal(result.transcription_text, 'quiero vender mi casa');
});
