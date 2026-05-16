'use strict';

/**
 * Contratos ejecutables V3 (F1) — validación de forma sin side effects.
 */
module.exports = {
  ...require('./conversationState.contract'),
  ...require('./conversationDecision.contract'),
  ...require('./goalsAndStages.contract'),
  ...require('./ruleGuard.contract'),
  ...require('./composer.contract'),
  ...require('./productionIsolation.contract'),
};
