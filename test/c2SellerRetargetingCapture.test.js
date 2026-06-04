'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const router = require('../conversation/leadEntryPointRouter');
const {
  matchesSellerAcquisitionPattern,
  inferOwnerOfferOperation,
  isRentOutOwnerPhrase,
  mentionsRentDemand,
} = require('../conversation/v3/interpreter/campaignIntake');

const PREV_HANDOFF = process.env.PERSEO_V3_HANDOFF_ENABLED;
const PREV_CRM = process.env.PERSEO_V3_CRM_DRY_RUN;

before(() => {
  process.env.PERSEO_V3_HANDOFF_ENABLED = 'true';
  process.env.PERSEO_V3_CRM_DRY_RUN = 'true';
});

after(() => {
  if (PREV_HANDOFF === undefined) delete process.env.PERSEO_V3_HANDOFF_ENABLED;
  else process.env.PERSEO_V3_HANDOFF_ENABLED = PREV_HANDOFF;
  if (PREV_CRM === undefined) delete process.env.PERSEO_V3_CRM_DRY_RUN;
  else process.env.PERSEO_V3_CRM_DRY_RUN = PREV_CRM;
});

function classifyOffer(text, prev = {}) {
  const meta = router.classifyEntryPoint(text, prev);
  const signals = router.applyEntryClassificationToSignals({}, text, prev);
  return { meta, signals };
}

describe('C2 retargeting — clasificación offer (legacy router)', () => {
  const casesOffer = [
    {
      n: 1,
      text: 'Hola Luxetty, quiero que me contacte un asesor. Estoy pensando vender una propiedad y me gustaría valorarla.',
      op: 'sale',
      c2: true,
    },
    {
      n: 2,
      text: 'Hola, quiero vender mi casa y quiero que me contacte un asesor.',
      op: 'sale',
    },
    {
      n: 3,
      text: 'Quiero valorar mi propiedad antes de vender.',
      op: 'sale',
    },
    {
      n: 4,
      text: 'Me interesa que un asesor me contacte para conocer el valor de mi casa.',
      op: 'sale',
    },
    {
      n: 5,
      text: 'Hola Luxetty, quiero que me contacte un asesor. Estoy pensando rentar una propiedad.',
      op: 'rent',
      c2: true,
    },
    {
      n: 6,
      text: 'Quiero poner en renta mi casa.',
      op: 'rent',
    },
    {
      n: 7,
      text: 'Quiero rentar mi propiedad y que me contacte un asesor.',
      op: 'rent',
    },
    {
      n: 8,
      text: 'Estoy pensando vender o rentar mi propiedad.',
      op: 'sale',
    },
  ];

  for (const c of casesOffer) {
    it(`#${c.n} offer — ${c.text.slice(0, 48)}…`, () => {
      assert.equal(matchesSellerAcquisitionPattern(c.text), true, 'patrón captación');
      const { meta, signals } = classifyOffer(c.text);
      assert.equal(meta.entry_type, 'seller_capture_ad');
      assert.equal(meta.lead_flow, 'offer');
      assert.equal(signals.lead_flow, 'offer');
      assert.notEqual(signals.lead_flow, 'demand');
      if (c.op === 'rent') {
        assert.equal(signals.operation_type, 'rent');
      } else {
        assert.equal(signals.operation_type, 'sale');
      }
      if (c.c2) assert.equal(meta.c2_retargeting, true);
    });
  }

  it('#9 orientación ambigua — pregunta vender/rentar/valorar', () => {
    const text = 'Quiero orientación sobre mi propiedad.';
    const { meta } = classifyOffer(text);
    assert.equal(meta.entry_type, 'seller_capture_ad');
    assert.equal(meta.lead_flow, 'offer');
    assert.equal(meta.ambiguous_owner_intent, true);
    const reply = router.buildInitialEntryReply({ entry: meta, property: null, aiState: {} });
    assert.match(reply, /vender, rentar o valorar/i);
  });

  it('#1 copy C2 inicial pide nombre y zona', () => {
    const text =
      'Hola Luxetty, quiero que me contacte un asesor. Estoy pensando vender una propiedad y me gustaría valorarla.';
    const meta = router.classifyEntryPoint(text, {});
    const reply = router.buildInitialEntryReply({ entry: meta, property: null, aiState: {} });
    assert.match(reply, /canalizarte correctamente con un asesor de Luxetty/i);
    assert.match(reply, /nombre/i);
    assert.match(reply, /colonia|zona/i);
  });

  const casesDemand = [
    { n: 10, text: 'Busco rentar una casa en Cumbres.' },
    { n: 11, text: 'Quiero comprar casa en Cumbres.' },
    { n: 12, text: 'Me interesa la propiedad que vi anunciada.' },
  ];

  for (const c of casesDemand) {
    it(`#${c.n} demand — no offer`, () => {
      const { meta, signals } = classifyOffer(c.text);
      assert.notEqual(meta.entry_type, 'seller_capture_ad');
      assert.equal(signals.lead_flow, 'demand');
      assert.equal(meta.lead_flow, 'demand');
    });
  }
});

describe('C2 retargeting — patrones campaignIntake', () => {
  it('rent-out vs demand rent', () => {
    assert.equal(isRentOutOwnerPhrase('Quiero rentar mi propiedad y que me contacte un asesor.'), true);
    assert.equal(mentionsRentDemand('Busco rentar una casa en Cumbres.'), true);
    assert.equal(matchesSellerAcquisitionPattern('Busco rentar una casa en Cumbres.'), false);
  });

  it('inferOwnerOfferOperation mixto', () => {
    assert.equal(inferOwnerOfferOperation('Estoy pensando vender o rentar mi propiedad.'), 'mixed');
  });
});

describe('C2 retargeting — V3 turno inicial', () => {
  const { processV3Turn, clearV3Session } = require('../conversation/v3');

  it('mensaje principal C2 → offer + copy canalización', () => {
    const cid = 'c2-main-msg';
    clearV3Session(cid);
    const r = processV3Turn({
      conversationId: cid,
      phone: '5215599000001',
      text: 'Hola Luxetty, quiero que me contacte un asesor. Estoy pensando vender una propiedad y me gustaría valorarla.',
    });
    assert.equal(r.state.leadFlow, 'offer');
    assert.notEqual(r.state.leadFlow, 'demand');
    assert.match(String(r.reply), /canalizarte correctamente con un asesor de Luxetty/i);
  });

  it('pensando rentar propiedad + Luxetty → offer rent', () => {
    const cid = 'c2-rent-owner';
    clearV3Session(cid);
    const r = processV3Turn({
      conversationId: cid,
      phone: '5215599000002',
      text: 'Hola Luxetty, quiero que me contacte un asesor. Estoy pensando rentar una propiedad.',
    });
    assert.equal(r.state.leadFlow, 'offer');
    assert.equal(r.state.operationType, 'rent');
  });
});
