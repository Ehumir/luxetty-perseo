'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { runMediaIntakeV1, maybeRunMediaIntakeV1 } = require('../conversation/v3/media/mediaIntakeV1');

describe('mediaIntakeV1', () => {
  const prev = process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED;

  before(() => {
    process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED = 'true';
  });

  after(() => {
    if (prev === undefined) delete process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED;
    else process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED = prev;
  });

  it('uses audio transcript as logical turn', () => {
    const r = runMediaIntakeV1({
      text: '',
      media: { kind: 'audio', transcript: 'Quiero vender en Cumbres', confidence: 0.9 },
    });
    assert.equal(r.media_intake.mode, 'transcript_used');
    assert.equal(r.logical_turn.text, 'Quiero vender en Cumbres');
    assert.equal(r.shortCircuitReply, undefined);
  });

  it('fallback when no transcript', () => {
    const r = runMediaIntakeV1({ text: '', media: { kind: 'audio', no_transcript: true } });
    assert.equal(r.media_intake.mode, 'audio_no_transcript');
    assert.match(r.shortCircuitReply, /escrito|texto/i);
  });

  it('low confidence asks confirmation', () => {
    const r = runMediaIntakeV1({
      text: '',
      media: { kind: 'audio', transcript: 'algo en cumbres', confidence: 0.2 },
    });
    assert.equal(r.media_intake.mode, 'audio_low_confidence');
    assert.match(r.shortCircuitReply, /confirm/i);
  });

  it('image illegible fallback', () => {
    const r = runMediaIntakeV1({ text: '', media: { kind: 'image', illegible: true } });
    assert.equal(r.media_intake.mode, 'image_illegible');
    assert.match(r.shortCircuitReply, /texto|describe/i);
  });

  it('image caption wins over hints', () => {
    const r = runMediaIntakeV1({
      text: 'Quiero vender en San Pedro',
      media: { kind: 'image', hints: [{ hint: 'mapa', confidence: 0.9 }] },
    });
    assert.equal(r.media_intake.mode, 'image_with_text');
    assert.match(r.logical_turn.text, /San Pedro/);
  });

  it('preserves line breaks for multiline slot messages', () => {
    const multiline = 'Busco comprar\nJorge\nCumbres\n5 millones';
    const enabled = runMediaIntakeV1({ text: multiline, media: null });
    assert.equal(enabled.logical_turn.text, multiline);

    const prevFlag = process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED;
    process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED = 'false';
    const disabled = maybeRunMediaIntakeV1({ text: multiline, media: null });
    if (prevFlag === undefined) delete process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED;
    else process.env.PERSEO_MEDIA_INTAKE_V1_ENABLED = prevFlag;
    assert.equal(disabled.logical_turn.text, multiline);
  });
});
