'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  mentionsBuyDemand,
  isDemandSearchInbound,
  isNonLocationPhrase,
  extractLooseLocationPhrase,
} = require('../conversation/v3/interpreter/campaignIntake');
const { normalizeLocationFromUserText } = require('../conversation/v3/interpreter/locationNormalizer');
const { interpretUserMessage } = require('../conversation/v3/interpreter/minimalInterpreter');
const { createInitialConversationState } = require('../conversation/v3/types/conversationState');
const { V3_INTENT, CONVERSATION_GOALS } = require('../conversation/v3/types/constants');
const contextualMemoryResolver = require('../conversation/contextualMemoryResolver');
const inventoryOptionsService = require('../services/inventoryOptionsService');

// ------------------------------------------------------------------
// A. Buy-side demand: comprador pidiendo inventario de venta ≠ vendedor
// ------------------------------------------------------------------
describe('BuySide demand classification', () => {
  it('detecta demanda de compra estilo inventario', () => {
    assert.equal(mentionsBuyDemand('¿Y en venta tienes?'), true);
    assert.equal(mentionsBuyDemand('¿Qué opciones de venta de menos 8 millones tienes?'), true);
    assert.equal(mentionsBuyDemand('quiero comprar casa'), true);
    assert.equal(isDemandSearchInbound('¿Y en venta tienes?'), true);
  });

  it('NO clasifica al vendedor como demanda de compra', () => {
    assert.equal(mentionsBuyDemand('quiero vender mi casa'), false);
    assert.equal(mentionsBuyDemand('voy a poner en venta mi departamento'), false);
    assert.equal(mentionsBuyDemand('necesito vender mi propiedad'), false);
  });

  it('"¿Y en venta tienes?" → BUY_PROPERTY demand/sale (no vendedor)', () => {
    const state = createInitialConversationState({ phone: '5218181877351' });
    const { decision, patch } = interpretUserMessage(state, '¿Y en venta tienes?');
    assert.equal(decision.detectedIntent, V3_INTENT.BUY_PROPERTY);
    assert.equal(patch.conversationGoal, CONVERSATION_GOALS.BUY_PROPERTY);
    assert.equal(patch.leadFlow, 'demand');
    assert.equal(patch.operationType, 'sale');
  });

  it('"venta de menos 8 millones tienes" → budget comprador, no expected_price vendedor', () => {
    const state = createInitialConversationState({ phone: '5218181877351' });
    const { decision, patch } = interpretUserMessage(
      state,
      '¿Qué opciones de venta de menos 8 millones tienes?'
    );
    assert.equal(decision.detectedIntent, V3_INTENT.BUY_PROPERTY);
    assert.equal(patch.leadFlow, 'demand');
    assert.equal(patch.operationType, 'sale');
    assert.equal(patch.budget, 8000000);
    assert.equal(patch.expectedPrice == null, true);
    // Y no debe capturar "menos 8 millones" como ubicación.
    assert.equal(patch.locationText == null, true);
  });

  it('"Quiero vender mi casa" sigue siendo SELL_PROPERTY', () => {
    const state = createInitialConversationState({ phone: '5218181877351' });
    const { patch } = interpretUserMessage(state, 'Quiero vender mi casa');
    assert.equal(patch.conversationGoal, CONVERSATION_GOALS.SELL_PROPERTY);
    assert.equal(patch.leadFlow, 'offer');
  });
});

// ------------------------------------------------------------------
// B. Slot capture guard: frases de frustración/corrección ≠ ubicación
// ------------------------------------------------------------------
describe('Location slot guard', () => {
  const bad = 'NO se de qué hablas, no me estás entendiendo';

  it('isNonLocationPhrase detecta frustración/confusión', () => {
    assert.equal(isNonLocationPhrase(bad), true);
    assert.equal(isNonLocationPhrase('no me estás entendiendo'), true);
    assert.equal(isNonLocationPhrase('Cumbres'), false);
    assert.equal(isNonLocationPhrase('Está en San Pedro'), false);
    // Corrección CON ubicación válida NO debe rechazarse.
    assert.equal(isNonLocationPhrase('ya te dije que en San Pedro'), false);
  });

  it('extractores de ubicación rechazan la frase de frustración', () => {
    assert.equal(extractLooseLocationPhrase(bad), null);
    assert.equal(normalizeLocationFromUserText(bad), null);
  });

  it('extractores siguen capturando ubicaciones reales', () => {
    assert.equal(normalizeLocationFromUserText('Está en Cumbres'), 'Cumbres');
    assert.ok(extractLooseLocationPhrase('Busco en San Pedro'));
  });
});

// ------------------------------------------------------------------
// C. Rendering: opciones reales con link
// ------------------------------------------------------------------
describe('Inventory options rendering', () => {
  it('buildContextualDemandReply muestra título · zona · precio + link', () => {
    const reply = contextualMemoryResolver.buildContextualDemandReply({
      aiState: { lead_flow: 'demand', operation_type: 'rent', location_text: 'Cumbres' },
      text: '¿Qué opciones de casas en renta tienes en Cumbres?',
      hasValidName: false,
      matchedProperties: [
        {
          id: 'p1',
          title: 'Casa en renta en Cumbres 4to Sector con alberca',
          location_label: 'Cumbres 4o Sector',
          price: 40000,
          price_label: '$40,000 MXN',
          operation_label: 'en renta',
          public_url: 'https://luxetty.com/propiedad/casa-en-renta-en-cumbres-4to-sector-con-alberca',
        },
      ],
      propertyTypeLabel: 'casa',
    });
    assert.match(reply, /luxetty\.com\/propiedad\/casa-en-renta-en-cumbres-4to-sector-con-alberca/);
    assert.match(reply, /\$40,000/);
    assert.match(reply, /Cumbres 4o Sector/);
  });
});

// ------------------------------------------------------------------
// D. inventoryOptionsService: helpers + búsqueda estructurada (mock db)
// ------------------------------------------------------------------
function makeMockDb(rows) {
  const builder = {
    from() {
      return this;
    },
    select() {
      return this;
    },
    eq() {
      return this;
    },
    lte() {
      return this;
    },
    or() {
      return this;
    },
    order() {
      return this;
    },
    limit() {
      return this;
    },
    then(resolve) {
      resolve({ data: rows, error: null });
    },
  };
  return { from: () => builder };
}

describe('inventoryOptionsService', () => {
  it('mapOperation y normalizeTypeKey', () => {
    assert.equal(inventoryOptionsService.mapOperation('renta'), 'rent');
    assert.equal(inventoryOptionsService.mapOperation('venta'), 'sale');
    assert.equal(inventoryOptionsService.normalizeTypeKey('casa'), 'house');
    assert.equal(inventoryOptionsService.normalizeTypeKey('departamento'), 'apartment');
  });

  it('isPublishableOption exige link + precio + active', () => {
    assert.equal(
      inventoryOptionsService.isPublishableOption({
        public_url: 'https://luxetty.com/propiedad/x',
        price: 100,
        status: 'active',
      }),
      true
    );
    assert.equal(inventoryOptionsService.isPublishableOption({ price: 100, status: 'active' }), false);
    assert.equal(
      inventoryOptionsService.isPublishableOption({
        public_url: 'https://luxetty.com/propiedad/x',
        price: null,
        status: 'active',
      }),
      false
    );
  });

  it('searchInventoryOptions devuelve solo publicables, ordenadas por precio', async () => {
    const rows = [
      {
        id: '2',
        listing_id: 'LUX-A0002',
        slug: 'casa-en-venta-en-cumbres-5to-sector',
        title: 'Casa en Cumbres 5to Sector',
        operation_type: 'sale',
        price: 7750000,
        status: 'active',
        neighborhood: 'Cumbres 5o. Sector',
        city: 'Monterrey',
        currency_code: 'MXN',
      },
      {
        id: '1',
        listing_id: 'LUX-A0001',
        slug: 'casa-en-cumbres-san-agustin-en-venta',
        title: 'Casa en Cumbres San Agustín',
        operation_type: 'sale',
        price: 6450000,
        status: 'active',
        neighborhood: 'Cumbres San Agustín',
        city: 'Monterrey',
        currency_code: 'MXN',
      },
      // no publicable: sin slug
      { id: '3', slug: null, title: 'X', operation_type: 'sale', price: 5000000, status: 'active' },
      // no publicable: sin precio
      { id: '4', slug: 'y-en-venta', title: 'Y', operation_type: 'sale', price: null, status: 'active' },
      // no publicable: no active
      {
        id: '5',
        slug: 'z-en-venta',
        title: 'Z',
        operation_type: 'sale',
        price: 100,
        status: 'sold',
      },
    ];
    const db = makeMockDb(rows);
    const res = await inventoryOptionsService.searchInventoryOptions(
      db,
      { operation: 'sale', zone: 'Cumbres', budgetMax: 8000000, limit: 3 },
      { warn() {} }
    );
    assert.equal(res.operation, 'sale');
    assert.equal(res.options.length, 2);
    assert.equal(res.options[0].id, '1'); // 6.45M antes que 7.75M
    assert.equal(res.options[1].id, '2');
    assert.match(res.options[0].public_url, /luxetty\.com\/propiedad\//);
  });

  it('sin resultados publicables → options vacío', async () => {
    const db = makeMockDb([
      { id: '4', slug: 'y-en-venta', title: 'Y', operation_type: 'sale', price: null, status: 'active' },
    ]);
    const res = await inventoryOptionsService.searchInventoryOptions(
      db,
      { operation: 'sale', zone: 'Cumbres', budgetMax: 8000000, limit: 3 },
      { warn() {} }
    );
    assert.equal(res.options.length, 0);
    assert.equal(res.source, 'none');
  });
});
