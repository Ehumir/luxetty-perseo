'use strict';

/**
 * Guardrail name-first: en el primer mensaje comercial válido, presentación Luxetty + pedir nombre
 * antes de menús de propiedad o calificación de compra.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const { hasValidHumanName } = require('./namePrompt');
const { isUsefulContactName, isInvalidContactName } = require('../utils/helpers');
const { extractPossibleName } = require('./parsers');
const leadEntryPointRouter = require('./leadEntryPointRouter');

function isUsefulWaProfileName(waProfileName) {
  const p = cleanSpaces(String(waProfileName || ''));
  if (!p) return false;
  return isUsefulContactName(p) && !isInvalidContactName(p);
}

function requiresName(contact, aiState, waProfileName) {
  return !hasValidHumanName(contact, aiState) && !isUsefulWaProfileName(waProfileName);
}

function countInboundRecent(recentMessages = []) {
  const list = Array.isArray(recentMessages) ? recentMessages : [];
  return list.filter((m) => m && m.direction === 'inbound').length;
}

function isFirstInboundTurn(recentMessages = []) {
  return countInboundRecent(recentMessages) === 0;
}

function shouldAskNameFirst(context = {}) {
  const { contact = null, aiState = {}, waProfileName = null, recentMessages = [], entryMeta = null } = context;
  if (!requiresName(contact, aiState, waProfileName)) return false;
  const meta = entryMeta || {};
  if (meta.entry_type === 'property_ad' || meta.entry_type === 'seller_capture_ad') return true;
  if (aiState?.awaiting_field === 'full_name') return true;
  if (isFirstInboundTurn(recentMessages) && (meta.entry_type === 'buyer_search' || meta.entry_type === 'unknown')) {
    return false;
  }
  return false;
}

function shouldCaptureIncomingName(text = '', aiState = {}) {
  const prev = aiState && typeof aiState === 'object' ? aiState : {};
  return !!extractPossibleName(text, prev, prev.owner_relation);
}

function shouldInterceptNameFirstIntro(context = {}) {
  const {
    text = '',
    contact = null,
    previousAiState = {},
    nextAiState = {},
    waProfileName = null,
    recentMessages = [],
    entryMeta = null,
  } = context;

  if (!requiresName(contact, nextAiState, waProfileName)) return false;
  if (!isFirstInboundTurn(recentMessages)) return false;

  const meta = entryMeta || leadEntryPointRouter.classifyEntryPoint(text, previousAiState);
  if (meta.entry_type === 'property_ad' || meta.entry_type === 'seller_capture_ad') return true;

  return false;
}

function shouldInterceptIdentityQuestion(text = '') {
  const t = normalizeText(text);
  return (
    t.includes('como te llamas') ||
    t.includes('cómo te llamas') ||
    t.includes('quien eres') ||
    t.includes('quién eres') ||
    t.includes('como te llaman') ||
    t.includes('cómo te llaman')
  );
}

function shouldInterceptAfterNameCapture(context = {}) {
  const { previousAiState = {}, nextAiState = {} } = context;
  const waitingName =
    previousAiState?.awaiting_field === 'full_name' || !!previousAiState?.pending_name_capture;
  if (!waitingName) return false;
  const nowName = cleanSpaces(String(nextAiState?.full_name || ''));
  const prevName = cleanSpaces(String(previousAiState?.full_name || ''));
  return !!nowName && nowName !== prevName;
}

function shouldInterceptComplaint(context = {}) {
  const { text = '' } = context;
  const t = normalizeText(text);
  return (
    t.includes('ya te di mi nombre') ||
    t.includes('ya te dije mi nombre') ||
    t.includes('no me lees') ||
    t.includes('de que hablas') ||
    t.includes('de qué hablas') ||
    t.includes('me pueden ayudar')
  );
}

function buildNameFirstReply(context = {}) {
  const { text = '', entryMeta = null, property = null, aiState = {} } = context;
  const meta = entryMeta || leadEntryPointRouter.classifyEntryPoint(text, aiState);
  return leadEntryPointRouter.buildInitialEntryReply({ entry: meta, property, aiState });
}

function buildAfterNameCapturedReply(context = {}) {
  const { nextAiState = {}, entryMeta = null } = context;
  const name = cleanSpaces(String(nextAiState.full_name || ''));
  const persisted =
    nextAiState.entry_point_last && typeof nextAiState.entry_point_last === 'object'
      ? nextAiState.entry_point_last
      : null;
  const meta =
    entryMeta && entryMeta.entry_type && entryMeta.entry_type !== 'unknown'
      ? entryMeta
      : persisted && persisted.entry_type
        ? persisted
        : leadEntryPointRouter.classifyEntryPoint('', nextAiState);
  return leadEntryPointRouter.buildNameAcknowledgementReply(name, { entry: meta, aiState: nextAiState });
}

/**
 * Evalúa turno inbound y decide si este módulo debe tomar la respuesta antes de V2 / fallback / flujo propiedad.
 * @returns {{ handled: boolean, reply?: string, statePatch?: object, skipEnforce?: boolean, skipEngineV2?: boolean, skipFallback?: boolean }}
 */
function evaluateInboundTurn(context = {}) {
  const {
    text = '',
    previousAiState = {},
    nextAiState = {},
    contact = null,
    waProfileName = null,
    recentMessages = [],
    propertyRow = null,
    entryMeta = null,
  } = context;

  const meta = entryMeta || leadEntryPointRouter.classifyEntryPoint(text, previousAiState);

  if (shouldInterceptIdentityQuestion(text)) {
    if (!requiresName(contact, nextAiState, waProfileName)) {
      const fn = cleanSpaces(String(nextAiState.full_name || '')).split(/\s+/)[0];
      return {
        handled: true,
        reply: fn
          ? `Soy el asistente de Luxetty. Gracias, ${fn}: ya tengo tu nombre para continuar. ¿En qué te ayudo a seguir?`
          : 'Soy el asistente de Luxetty. Dime cómo te ayudo a seguir.',
        statePatch: {},
        skipEnforce: true,
        skipEngineV2: true,
        skipFallback: true,
      };
    }
    return {
      handled: true,
      reply: leadEntryPointRouter.buildAssistantIdentityReply(),
      statePatch: { awaiting_field: 'full_name', pending_name_capture: true },
      skipEnforce: true,
      skipEngineV2: true,
      skipFallback: true,
    };
  }

  if (shouldInterceptComplaint({ text, previousAiState, nextAiState, contact, waProfileName })) {
    return {
      handled: true,
      reply: leadEntryPointRouter.buildComplaintRecoveryReply({ aiState: nextAiState, contact, waProfileName }),
      statePatch: {},
      skipEnforce: true,
      skipEngineV2: true,
      skipFallback: true,
    };
  }

  if (shouldInterceptAfterNameCapture({ previousAiState, nextAiState, contact, waProfileName, entryMeta: meta })) {
    const persisted = previousAiState.entry_point_last && typeof previousAiState.entry_point_last === 'object'
      ? previousAiState.entry_point_last
      : null;
    const effMeta =
      persisted && persisted.entry_type
        ? { ...meta, ...persisted, entry_type: persisted.entry_type }
        : meta;

    const patch = {
      pending_name_capture: false,
      entry_point_last: effMeta,
    };
    if (effMeta.entry_type === 'property_ad') {
      patch.awaiting_field = null;
      const code = cleanSpaces(String(nextAiState.property_code || nextAiState.direct_property_code || ''));
      if (code) patch.property_intro_shown_for_code = code;
    } else if (effMeta.entry_type === 'seller_capture_ad') {
      patch.awaiting_field = 'owner_relation';
    } else {
      patch.awaiting_field = null;
    }

    const reply = leadEntryPointRouter.buildNameAcknowledgementReply(nextAiState.full_name, {
      entry: effMeta,
      aiState: nextAiState,
    });
    console.log('[NAME_CAPTURE_OK]', {
      full_name: cleanSpaces(String(nextAiState.full_name || '')),
      property_code: cleanSpaces(String(nextAiState.property_code || nextAiState.direct_property_code || '')),
    });
    return {
      handled: true,
      reply,
      statePatch: patch,
      skipEnforce: true,
      skipEngineV2: true,
      skipFallback: true,
    };
  }

  if (
    shouldInterceptNameFirstIntro({
      text,
      contact,
      previousAiState,
      nextAiState,
      waProfileName,
      recentMessages,
      entryMeta: meta,
    })
  ) {
    const code = cleanSpaces(String(meta.property_code || nextAiState.property_code || ''));
    const patch = {
      awaiting_field: 'full_name',
      pending_name_capture: true,
      entry_point_last: {
        entry_type: meta.entry_type,
        lead_flow: meta.lead_flow,
        property_code: meta.property_code,
        location_text: meta.location_text || nextAiState.location_text || null,
      },
    };
    if (meta.entry_type === 'property_ad' && code) {
      patch.property_intro_shown_for_code = code;
    }

    return {
      handled: true,
      reply: buildNameFirstReply({ text, entryMeta: meta, property: propertyRow, aiState: nextAiState }),
      statePatch: patch,
      skipEnforce: true,
      skipEngineV2: true,
      skipFallback: true,
    };
  }

  return { handled: false };
}

module.exports = {
  shouldAskNameFirst,
  shouldCaptureIncomingName,
  buildNameFirstReply,
  buildAfterNameCapturedReply,
  evaluateInboundTurn,
  requiresName,
  isFirstInboundTurn,
};
