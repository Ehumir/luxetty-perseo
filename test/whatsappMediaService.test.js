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
    },
  });

  assert.equal(descriptor.shouldDownload, true);
  assert.equal(descriptor.mediaType, 'image');
  assert.equal(descriptor.mediaId, 'img-123');
  assert.equal(descriptor.caption, 'Fachada principal');
  assert.equal(descriptor.mimeType, 'image/jpeg');
});

test('descriptor supports contacts and interactive as non-downloadable', () => {
  const contactsDescriptor = getInboundMediaDescriptor({ type: 'contacts' });
  const interactiveDescriptor = getInboundMediaDescriptor({ type: 'interactive' });

  assert.equal(contactsDescriptor.shouldDownload, false);
  assert.equal(interactiveDescriptor.shouldDownload, false);
  assert.equal(interactiveDescriptor.reason, 'not_downloadable_media_type');
});

test('descriptor handles document metadata', () => {
  const descriptor = getInboundMediaDescriptor({
    type: 'document',
    document: {
      id: 'doc-777',
      filename: 'escritura.pdf',
      caption: 'escritura completa',
      mime_type: 'application/pdf',
    },
  });

  assert.equal(descriptor.shouldDownload, true);
  assert.equal(descriptor.mediaId, 'doc-777');
  assert.equal(descriptor.fileName, 'escritura.pdf');
  assert.equal(descriptor.mimeType, 'application/pdf');
});
