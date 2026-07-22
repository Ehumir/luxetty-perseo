'use strict';

/**
 * Resuelve opciones de inventario para un turno demanda (pre-V3).
 * Solo lectura SoT + RAG rerank; nunca inventa.
 */

const { normalizeText, cleanSpaces } = require('../utils/text');
const {
  isInventoryOptionsEffectiveForUser,
} = require('../config/accP0Flags');
const {
  mentionsRentDemand,
  mentionsBuyDemand,
  isDemandSearchInbound,
  extractLooseLocationPhrase,
} = require('../conversation/v3/interpreter/campaignIntake');
const { normalizeLocationFromUserText } = require('../conversation/v3/interpreter/locationNormalizer');
const { parseMoneyAmount } = require('../conversation/v3/interpreter/moneyParser');
const inventoryOptionsService = require('./inventoryOptionsService');

function resolveDemandOperation(text, previousAiState = {}) {
  const t = normalizeText(String(text || ''));
  const prevOp = String(previousAiState.operation_type || previousAiState.operationType || '').toLowerCase();
  const prevGoal = String(previousAiState.conversation_goal || previousAiState.conversationGoal || '');
  if (mentionsRentDemand(t)) return 'rent';
  if (mentionsBuyDemand(t)) return 'sale';
  if (prevOp === 'rent' || prevGoal === 'RENT_PROPERTY') return 'rent';
  if (prevOp === 'sale' || prevGoal === 'BUY_PROPERTY') return 'sale';
  if (/\brenta\b/.test(t)) return 'rent';
  if (/\bventa\b|\bcomprar\b/.test(t)) return 'sale';
  return null;
}

function shouldAttemptInventorySearch({ text, previousAiState = {}, phone } = {}) {
  if (!isInventoryOptionsEffectiveForUser(phone)) return false;
  const t = String(text || '');
  const demand =
    isDemandSearchInbound(t) ||
    mentionsRentDemand(normalizeText(t)) ||
    mentionsBuyDemand(normalizeText(t)) ||
    previousAiState.lead_flow === 'demand' ||
    previousAiState.leadFlow === 'demand' ||
    ['BUY_PROPERTY', 'RENT_PROPERTY'].includes(
      String(previousAiState.conversation_goal || previousAiState.conversationGoal || '')
    );
  if (!demand) return false;
  // No buscar en captación/offer.
  if (previousAiState.lead_flow === 'offer' || previousAiState.leadFlow === 'offer') return false;
  return true;
}

/**
 * @returns {Promise<{matchedOptions: object[], inventorySearchMeta: object}|null>}
 */
async function resolveInventoryOptionsForTurn({
  db,
  text,
  phone,
  previousAiState = {},
  logger = console,
} = {}) {
  if (!shouldAttemptInventorySearch({ text, previousAiState, phone })) {
    return null;
  }

  const operation = resolveDemandOperation(text, previousAiState);
  if (!operation) return null;

  const zone =
    cleanSpaces(String(previousAiState.location_text || previousAiState.locationText || '')) ||
    normalizeLocationFromUserText(text) ||
    extractLooseLocationPhrase(text) ||
    null;

  let budgetMax =
    previousAiState.budget_max != null
      ? Number(previousAiState.budget_max)
      : previousAiState.budget != null
        ? Number(previousAiState.budget)
        : null;
  if (budgetMax == null || !Number.isFinite(budgetMax)) {
    budgetMax = parseMoneyAmount(text);
  }

  // Mínimo: operación + (zona o presupuesto) para no disparar búsquedas vacías genéricas.
  if (!zone && budgetMax == null) {
    // Aún así, si el usuario pide opciones explícitamente, buscar por operación sola.
    const asksOptions = /\b(?:opciones?|tienes|tienen|hay|muestrame|muéstrame|mostrar)\b/i.test(
      String(text || '')
    );
    if (!asksOptions) return null;
  }

  const res = await inventoryOptionsService.searchInventoryOptions(
    db,
    {
      operation,
      zone,
      budgetMax,
      queryText: text,
      limit: 3,
    },
    logger
  );

  const options = Array.isArray(res.options) ? res.options : [];
  return {
    matchedOptions: options,
    inventorySearchMeta: {
      attempted: true,
      source: res.source || 'none',
      operation: res.operation,
      zone: res.zone,
      budgetMax: res.budgetMax,
      relaxedZone: !!res.relaxedZone,
      emptyAfterSearch: options.length === 0,
    },
  };
}

module.exports = {
  shouldAttemptInventorySearch,
  resolveDemandOperation,
  resolveInventoryOptionsForTurn,
};
