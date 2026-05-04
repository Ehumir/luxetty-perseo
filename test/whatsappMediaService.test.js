const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getInboundMediaDescriptor,
  isAllowedDownload,
  resolveInboundMedia,
} = require('../services/whatsappMediaService');

test('descriptor detects downloadable image payload', () => {
  const descriptor = getInboundMediaDescriptor({
    type: 'image',
    image: {
      id: 'img-123',
      caption: 'Fachada principal',
      mime_type: 'image/jpeg',
      sha256: 'sha-img-1',
    },
  });

  assert.equal(descriptor.shouldDownload, true);
  assert.equal(descriptor.mediaType, 'image');
  assert.equal(descriptor.mediaId, 'img-123');
  assert.equal(descriptor.caption, 'Fachada principal');
  assert.equal(descriptor.mimeType, 'image/jpeg');
  assert.equal(descriptor.sha256, 'sha-img-1');
});

test('descriptor supports contacts and interactive as non-downloadable', () => {
  const contactsDescriptor = getInboundMediaDescriptor({ type: 'contacts' });
  const interactiveDescriptor = getInboundMediaDescriptor({ type: 'interactive' });

  assert.equal(contactsDescriptor.shouldDownload, false);
  assert.equal(interactiveDescriptor.shouldDownload, false);
  assert.equal(interactiveDescriptor.reason, 'skipped_unsupported');
});

test('descriptor handles document metadata', () => {
  const descriptor = getInboundMediaDescriptor({
    type: 'document',
    document: {
      id: 'doc-777',
      filename: 'escritura.pdf',
      caption: 'escritura completa',
      mime_type: 'application/pdf',
      sha256: 'sha-doc-1',
    },
  });

  assert.equal(descriptor.shouldDownload, true);
  assert.equal(descriptor.mediaId, 'doc-777');
  assert.equal(descriptor.fileName, 'escritura.pdf');
  assert.equal(descriptor.mimeType, 'application/pdf');
  assert.equal(descriptor.sha256, 'sha-doc-1');
});

test('descriptor marks video as received but not downloadable in 4A', () => {
  const descriptor = getInboundMediaDescriptor({
    type: 'video',
    video: {
      id: 'vid-1',
      mime_type: 'video/mp4',
    },
  });

  assert.equal(descriptor.mediaType, 'video');
  assert.equal(descriptor.shouldDownload, false);
  assert.equal(descriptor.reason, 'skipped_video_not_processed');
});

test('isAllowedDownload accepts audio mime with codecs parameter', () => {
  const descriptor = getInboundMediaDescriptor({
    type: 'audio',
    audio: {
      id: 'aud-1',
      mime_type: 'audio/ogg; codecs=opus',
      voice: true,
    },
  });

  const policy = isAllowedDownload(descriptor);
  assert.equal(policy.allowed, true);
  assert.equal(policy.reason, null);
});

test('resolveInboundMedia prioritizes metadata mime when download returns octet-stream', async () => {
  const message = {
    type: 'audio',
    audio: {
      id: 'aud-555',
      mime_type: 'audio/ogg; codecs=opus',
      voice: true,
    },
  };

  let callCount = 0;
  const httpClient = {
    async get() {
      callCount += 1;
      if (callCount === 1) {
        return {
          data: {
            id: 'aud-555',
            mime_type: 'audio/ogg; codecs=opus',
            url: 'https://graph-media.test/audio-file',
          },
        };
      }

      return {
        data: Buffer.from('fake-audio'),
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': '10',
        },
      };
    },
  };

  const result = await resolveInboundMedia(message, {
    httpClient,
    whatsappToken: 'fake-token',
  });

  assert.equal(result.success, true);
  assert.equal(result.download_status, 'downloaded');
  assert.equal(result.mime_type, 'audio/ogg');
  assert.equal(result.metadata_mime_original, 'audio/ogg; codecs=opus');
  assert.equal(result.response_content_type_original, 'application/octet-stream');
  assert.equal(result.media_url_resolved, true);
});

test('resolveInboundMedia fails when metadata URL is missing', async () => {
  const message = {
    type: 'audio',
    audio: {
      id: 'aud-no-url',
      mime_type: 'audio/ogg',
    },
  };

  const httpClient = {
    async get() {
      return {
        data: {
          id: 'aud-no-url',
          mime_type: 'audio/ogg',
          url: null,
        },
      };
    },
  };

  const result = await resolveInboundMedia(message, {
    httpClient,
    whatsappToken: 'fake-token',
  });

  assert.equal(result.success, false);
  assert.equal(result.download_status, 'failed');
  assert.equal(result.error_code, 'metadata_missing_media_url');
});
