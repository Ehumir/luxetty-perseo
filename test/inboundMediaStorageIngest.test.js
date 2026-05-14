'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWhatsappMediaRecord,
  mimeToFileExtension,
  applyWhatsappMediaMetadata,
  shouldSkipIngestAlreadyStored,
  hasGraphMediaToken,
  runInboundMediaIngest,
} = require('../services/inboundMediaStorageIngest');

test('mimeToFileExtension maps MVP mimes', () => {
  assert.equal(mimeToFileExtension('image/jpeg'), 'jpg');
  assert.equal(mimeToFileExtension('application/pdf'), 'pdf');
  assert.equal(mimeToFileExtension('audio/ogg'), 'ogg');
  assert.equal(mimeToFileExtension('audio/ogg; codecs=opus'), 'ogg');
});

test('buildWhatsappMediaRecord uses snake_case metadata fields', () => {
  const r = buildWhatsappMediaRecord({
    waMessageType: 'image',
    metaMediaId: 'mid-1',
    mimeType: 'image/jpeg',
    byteSize: 10,
    storageBucket: 'whatsapp-inbound-media',
    storagePath: 'c/m.jpg',
    downloadStatus: 'stored',
    ingestedAt: '2026-01-01T00:00:00.000Z',
    errorCode: null,
    filename: null,
    captionPresent: true,
  });
  assert.equal(r.schema_version, 1);
  assert.equal(r.wa_message_type, 'image');
  assert.equal(r.download_status, 'stored');
  assert.equal(r.caption_present, true);
});

test('applyWhatsappMediaMetadata merges without dropping sibling keys', async () => {
  const state = {
    rows: new Map([
      [
        'msg-1',
        {
          metadata: { delivery_status: 'sent', client_request_id: 'abc' },
        },
      ],
    ]),
  };

  let fromCalls = 0;
  const supabase = {
    from() {
      fromCalls += 1;
      if (fromCalls === 1) {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: { metadata: { ...state.rows.get('msg-1').metadata } },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      return {
        update(payload) {
          return {
            eq: async () => {
              const prev = state.rows.get('msg-1');
              prev.metadata = payload.metadata;
              state.rows.set('msg-1', prev);
              return { error: null };
            },
          };
        },
      };
    },
  };

  const wm = buildWhatsappMediaRecord({
    waMessageType: 'sticker',
    metaMediaId: 's1',
    mimeType: 'image/webp',
    byteSize: null,
    storageBucket: null,
    storagePath: null,
    downloadStatus: 'skipped_unsupported',
    ingestedAt: '2026-01-01T00:00:00.000Z',
    errorCode: null,
    filename: null,
    captionPresent: false,
  });

  const r = await applyWhatsappMediaMetadata(supabase, 'msg-1', wm);
  assert.equal(r.ok, true);
  const meta = state.rows.get('msg-1').metadata;
  assert.equal(meta.delivery_status, 'sent');
  assert.equal(meta.client_request_id, 'abc');
  assert.equal(meta.whatsapp_media.download_status, 'skipped_unsupported');
});

test('shouldSkipIngestAlreadyStored is true when stored', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: { metadata: { whatsapp_media: { download_status: 'stored' } } },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  };
  const y = await shouldSkipIngestAlreadyStored(supabase, 'x');
  assert.equal(y, true);
});

test('runInboundMediaIngest no-op when flag is not true', async () => {
  const prev = process.env.PERSEO_INBOUND_MEDIA_STORAGE_ENABLED;
  process.env.PERSEO_INBOUND_MEDIA_STORAGE_ENABLED = 'false';
  const calls = [];
  await runInboundMediaIngest({
    supabase: {
      from() {
        calls.push('from');
        return {};
      },
    },
    logEvent: () => {},
    conversationId: 'c1',
    inboundMessageId: 'm1',
    message: { type: 'image', image: { id: 'x' } },
  });
  process.env.PERSEO_INBOUND_MEDIA_STORAGE_ENABLED = prev;
  assert.equal(calls.length, 0);
});

test('hasGraphMediaToken reflects env (no secrets in test)', () => {
  assert.equal(typeof hasGraphMediaToken(), 'boolean');
});
