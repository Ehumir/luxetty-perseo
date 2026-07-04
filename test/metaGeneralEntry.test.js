'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classifyEntryPoint } = require('../conversation/leadEntryPointRouter');
const { isMetaGeneralEntryText, resolvePriorityIntent } = require('../conversation/conversationPriorityResolver');
const { resolveConversationOpening } = require('../conversation/conversationOpeningResolver');
const { getDefaultAiState } = require('../conversation/aiState');
const { findForbiddenOpeningSnippet } = require('../conversation/contracts/conversationOpeningContract');

describe('metaGeneralEntry', () => {
  it('detecta frases Meta/Facebook', () => {
    assert.equal(
      isMetaGeneralEntryText('Estoy navegando en facebook y Vi su página inmobiliaria'),
      true,
    );
    assert.equal(isMetaGeneralEntryText('vi su anuncio en instagram'), true);
    assert.equal(isMetaGeneralEntryText('busco casa en Cumbres'), false);
  });

  it('classifyEntryPoint usa meta_general_entry', () => {
    const meta = classifyEntryPoint(
      'Estoy navegando en facebook y Vi su página inmobiliaria',
      getDefaultAiState(),
    );
    assert.equal(meta.entry_type, 'meta_general_entry');
    assert.equal(meta.lead_flow, null);
  });

  it('priority es meta_general no buyer_search', () => {
    const p = resolvePriorityIntent(
      'Estoy navegando en facebook y Vi su página inmobiliaria',
      getDefaultAiState(),
      {},
    );
    assert.equal(p.key, 'meta_general');
    assert.equal(p.entry_type, 'meta_general_entry');
  });

  it('opening responde comercial sin genérico de búsqueda', () => {
    const opening = resolveConversationOpening({
      text: 'Estoy navegando en facebook y Vi su página inmobiliaria 👍',
      previousAiState: getDefaultAiState(),
      nextAiState: getDefaultAiState(),
      parsedSignals: {},
      recentMessages: [{ direction: 'inbound', message_text: 'hola' }],
    });
    assert.equal(opening.handled, true);
    assert.equal(opening.opening_type, 'meta_general');
    assert.equal(findForbiddenOpeningSnippet(opening.reply), null);
    assert.doesNotMatch(String(opening.reply), /dime un poco más|búsqueda|presupuesto/i);
    assert.match(String(opening.reply), /propiedad|asesor|Luxetty|atención/i);
  });
});
