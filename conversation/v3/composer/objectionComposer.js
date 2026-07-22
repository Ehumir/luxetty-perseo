'use strict';

const { pickGroundedExcerpt } = require('../rag/ragTurnOrchestrator');

function safeGroundedSuffix(contextPack) {
  const excerpt = pickGroundedExcerpt(contextPack);
  if (!excerpt || /\d+\s*%/.test(excerpt)) return '';
  return ` ${excerpt}`;
}
const { firstName } = require('./postHandoffComposer');
const {
  composeContextualConfusionReply,
  composeCurtDirectReply,
} = require('./humanityHandoffComposer');

/**
 * @param {import('../interpreter/objectionClassifier').ObjectionKind} kind
 * @param {import('../types/conversationState').ConversationState} state
 */
function composeObjectionReply(kind, state) {
  const nm = firstName(state);

  switch (kind) {
    case 'sale_urgency_emotional': {
      const zone = state.locationText || null;
      const head = nm ? `Te entiendo, ${nm}.` : 'Te entiendo.';
      const zoneQ = zone
        ? `Seguimos con la venta en ${zone}.`
        : 'Para avanzar sin presión: ¿en qué zona está la propiedad y cómo te llamas?';
      return {
        responseText: `${head} Vender con prisa puede generar ansiedad; con calma ordenamos lo básico. ${zoneQ}`,
        followUpQuestion: zone ? '¿Cómo te llamas?' : null,
        awaitingField: zone ? 'full_name' : 'location_text',
        toneFlags: { empathetic: true, humanity: true },
      };
    }
    case 'sell_valuation_unknown': {
      const zone = state.locationText || 'esa zona';
      const head = nm ? `Entiendo, ${nm}.` : 'Entiendo.';
      const suffix = safeGroundedSuffix(state.ragContextPack);
      return {
        responseText: `${head} Sin problema si aún no tienes un precio esperado: un asesor de Luxetty puede apoyarte con la valuación en ${zone}.${suffix} ¿La propiedad está habitada, rentada o libre?`,
        followUpQuestion: null,
        awaitingField: 'occupancy_status',
        toneFlags: { consultive: true, valuation: true, rag_grounded: !!suffix },
      };
    }
    case 'bot_identity':
      return {
        responseText:
          'Soy el asesor IA de Luxetty: te ayudo a orientarte y reunir lo básico (zona, presupuesto o datos de tu propiedad). Si necesitas criterio humano, canalizo con un asesor del equipo sin problema. ¿En qué te ayudo ahora?',
        followUpQuestion: null,
        awaitingField: state.awaitingField,
        toneFlags: { consultive: true, botTransparency: true },
      };
    case 'human_request':
      return null;
    case 'frustration_not_understood':
    case 'useless':
      if (
        state.conversationStage === 'HANDOFF_PENDING' ||
        state.handoffStage === 'HANDOFF_PENDING'
      ) {
        return null;
      }
      if (state.conversationGoalLocked && state.conversationGoal) {
        return composeContextualConfusionReply(state);
      }
      return {
        responseText: nm
          ? `${nm}, te escucho. Para no darte vueltas: ¿buscas vender, comprar, rentar o consultar una propiedad por código?`
          : 'Te escucho. Para orientarte sin dar vueltas: ¿buscas vender, comprar, rentar o una propiedad por código?',
        followUpQuestion: null,
        awaitingField: null,
        toneFlags: { consultive: true },
      };
    case 'curt_direct_question':
      return composeCurtDirectReply(state);
    case 'commission': {
      const suffix = safeGroundedSuffix(state.ragContextPack);
      return {
        responseText:
          'La comisión depende del tipo de operación, zona y servicios (valuación, promoción, exclusiva, etc.). Un asesor de Luxetty puede explicarte el esquema sin compromiso; aquí no cierro un porcentaje fijo porque podría no aplicar a tu caso.' +
          suffix,
        followUpQuestion: null,
        awaitingField: state.awaitingField,
        toneFlags: { consultive: true, objection: true, rag_grounded: !!suffix },
      };
    }
    case 'competitor_price':
      return {
        responseText:
          'Entiendo la comparación. Lo que conviene revisar no es solo el porcentaje, sino alcance (promoción, filtro de compradores, tiempos). Si quieres, un asesor de Luxetty te explica opciones sin presión.',
        followUpQuestion: null,
        awaitingField: state.awaitingField,
        toneFlags: { consultive: true, objection: true },
      };
    case 'no_exclusivity': {
      const suffix = safeGroundedSuffix(state.ragContextPack);
      return {
        responseText:
          'Sin exclusiva también se puede trabajar; el esquema cambia en exposición y prioridad. Un asesor puede contarte cómo lo manejan en tu zona sin obligarte a firmar nada por aquí.' +
          suffix,
        followUpQuestion: null,
        awaitingField: state.awaitingField,
        toneFlags: { consultive: true, objection: true, rag_grounded: !!suffix },
      };
    }
    case 'already_listed':
      return {
        responseText:
          'Perfecto, si ya está publicada podemos revisar si conviene ajustar precio, exposición o estrategia. ¿En qué zona está y qué precio manejas ahora?',
        followUpQuestion: null,
        awaitingField: state.awaitingField || 'location_text',
        toneFlags: { consultive: true, objection: true },
      };
    default:
      return null;
  }
}

/**
 * @param {import('../types/conversationState').ConversationState} state
 * @param {string} text
 */
function tryComposeObjectionTurn(state, text) {
  const { classifyObjection } = require('../interpreter/objectionClassifier');
  const kind = classifyObjection(text, state);
  if (
    !kind ||
    kind === 'post_close_ack' ||
    kind === 'handoff_pending_frustration' ||
    kind === 'bot_identity' ||
    kind === 'human_request'
  ) {
    return null;
  }
  return composeObjectionReply(kind, state);
}

module.exports = {
  composeObjectionReply,
  tryComposeObjectionTurn,
};
