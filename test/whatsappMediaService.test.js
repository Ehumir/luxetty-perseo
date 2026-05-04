const test = require('node:test');
const assert = require('node:assert/strict');

const { getInboundMediaDescriptor } = require('../services/whatsappMediaService');

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
