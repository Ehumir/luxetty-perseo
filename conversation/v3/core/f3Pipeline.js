'use strict';

const { mergeConversationState } = require('../types/conversationState');
const { CONVERSATION_STAGES, ADVISOR_CONTACT_CONSENT, V3_INTENT } = require('../types/constants');
const {
  evaluateQualification,
  buildPlannerStatePatch,
} = require('../planner/qualificationPlanner');
const { processHandoff } = require('../planner/handoffPlanner');
const { buildCrmDryRunPayload } = require('../crm/payloadBuilder');
const { composePlannerResponse, composePlannerReplyText } = require('../composer/plannerComposer');
const { applyPropertyReplyAntiLoop } = require('../composer/slotTemplates');
const { getPerseoV3Config } = require('../../../config/perseoV3Flags');
const { v3Log } = require('./v3Logger');

/**
 * @param {{ state: import('../types/conversationState').ConversationState, decision: object, text: string }} input
 */
function runF3Pipeline(input) {
  const state = input.state;
  const decision = input.decision || {};
  const text = String(input.text || '');

  const plannerOut = evaluateQualification(state);
  let next = mergeConversationState(state, buildPlannerStatePatch(state, plannerOut));

  const handoffOut = processHandoff(next, text, decision, plannerOut);
  next = mergeConversationState(next, handoffOut.patch);

  if (plannerOut.qualificationComplete && !handoffOut.patch.conversationStage) {
    next = mergeConversationState(next, {
      conversationStage: CONVERSATION_STAGES.QUALIFICATION_COMPLETE,
      handoffStage: CONVERSATION_STAGES.QUALIFICATION_COMPLETE,
    });
  }

  if (next.advisorContactConsent === ADVISOR_CONTACT_CONSENT.ACCEPTED) {
    const cfg = getPerseoV3Config();
    const payload = cfg.crmDryRun !== false ? buildCrmDryRunPayload(next) : null;
    if (payload) {
      next = mergeConversationState(next, {
        crmPayloadReady: true,
        crmPayloadPreview: payload,
        conversationStage: CONVERSATION_STAGES.CRM_READY,
        handoffStage: CONVERSATION_STAGES.CRM_READY,
      });
      v3Log('crm_dry_run_payload', {
        conversation_id: next.conversationId,
        intent: payload.intent,
        advisor_contact_consent: payload.advisor_contact_consent,
      });
    }
  }

  const composed = composePlannerResponse({
    state: next,
    decision,
    plannerOut,
    handoffOut,
  });

  const rawReply = composePlannerReplyText({
    state: next,
    decision,
    plannerOut,
    handoffOut,
  });

  const anti = applyPropertyReplyAntiLoop({
    state: next,
    replyText: rawReply,
    handoffOut,
  });
  const replyText = anti.text;

  const questionFromReply = (() => {
    const matches = String(replyText || '').match(/¿[^?]+\?/g);
    return matches && matches.length ? matches[matches.length - 1] : null;
  })();

  const isFactHelpfulTurn =
    decision.detectedIntent === V3_INTENT.PROPERTY_FACT_QUESTION &&
    handoffOut.action === 'PROPERTY_QA_CONTINUE';

  const composerIntent = `${decision.detectedIntent || 'null'}|${handoffOut.action}`;

  let nextLoopRisk = Number(next.loopRiskScore) || 0;
  if (anti.replaced) nextLoopRisk += 1;

  let nextAnswerCount = Number(next.propertyQaAnswerCount) || 0;
  if (isFactHelpfulTurn) nextAnswerCount += 1;

  let lastOfferTypeNext = next.lastOfferType != null ? next.lastOfferType : null;
  if (handoffOut.action === 'OFFER_HANDOFF') lastOfferTypeNext = 'HANDOFF_PROPERTY';
  else if (isFactHelpfulTurn) lastOfferTypeNext = 'FACT';

  const lastFam = isFactHelpfulTurn
    ? decision.propertyInquiryFamily || next.lastAnsweredPropertyFamily || null
    : next.lastAnsweredPropertyFamily ?? null;

  const finalState = mergeConversationState(next, {
    lastAssistantReply: replyText,
    lastAssistantQuestion: composed.followUpQuestion || questionFromReply,
    awaitingField:
      composed.awaitingField !== undefined && composed.awaitingField !== null
        ? composed.awaitingField
        : next.awaitingField,
    lastComposerIntent: composerIntent,
    lastOfferType: lastOfferTypeNext,
    propertyQaAnswerCount: nextAnswerCount,
    lastAnsweredPropertyFamily: lastFam,
    loopRiskScore: nextLoopRisk,
  });

  return {
    state: finalState,
    composed,
    replyText,
    plannerOut,
    handoffOut,
  };
}

module.exports = {
  runF3Pipeline,
};
