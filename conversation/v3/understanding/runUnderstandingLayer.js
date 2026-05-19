'use strict';

const { isMessagePlannerEnabled, isPolicyEngineEnabled } = require('../../../config/perseoM2Flags');
const { segmentMessage } = require('./messageSegmenter');
const { detectSegmentIntents } = require('./multiIntentDetector');
const { extractAllSegmentSlots } = require('./segmentSlotExtractor');
const { evaluatePolicy } = require('../policy/PolicyEngine');
const { buildResponsePlan } = require('./responsePlanner');
const { applyPolicyRuntimeOverlay } = require('../policy/policyRuntime');

/**
 * @param {{
 *   state: object,
 *   decision: object,
 *   text: string,
 * }} input
 */
function runUnderstandingLayer(input) {
  const plannerOn = isMessagePlannerEnabled();
  const policyOn = isPolicyEngineEnabled();
  if (!plannerOn && !policyOn) return null;

  let segments = segmentMessage(input.text).map((s) => ({
    ...s,
    intents: detectSegmentIntents(s.text),
  }));

  if (plannerOn) {
    segments = extractAllSegmentSlots(segments);
  } else {
    segments = segments.map((s) => ({ ...s, slots: {} }));
  }

  let policyResult = null;
  if (policyOn) {
    const runtimeOverlay = applyPolicyRuntimeOverlay({
      phone: input.state?.phone,
      language: 'es',
      zone: input.state?.locationText || input.state?.filters?.zone,
      colonia: input.state?.collectedFields?.colonia,
      amount: input.state?.budget ?? input.state?.filters?.budget_max,
    });
    policyResult = evaluatePolicy({
      state: {
        ...input.state,
        policyRuntimeOverlay: runtimeOverlay.applied ? runtimeOverlay : null,
      },
      decision: input.decision,
      text: input.text,
      segments,
    });
    if (runtimeOverlay.applied && policyResult) {
      policyResult.policy_runtime_applied = true;
      policyResult.policy_runtime_rule_id = runtimeOverlay.policy_runtime_rule_id;
    }
  }

  const responsePlan =
    plannerOn || policyOn
      ? buildResponsePlan({ segments, policyResult, state: input.state })
      : null;

  const patchFromSegments = buildPatchFromSegments(segments, policyResult);

  return {
    segments,
    policyResult,
    responsePlan,
    patchFromSegments,
  };
}

const { extractInlineZone } = require('./segmentSlotExtractor');
const { isLikelyFirstNameOnly } = require('../interpreter/identityCompoundCapture');
const { isBareKnownZoneToken } = require('../interpreter/locationNormalizer');

/**
 * @param {object[]} segments
 * @param {object|null} policyResult
 */
function buildPatchFromSegments(segments, policyResult) {
  const patch = {};
  if (!segments.length) return patch;

  const demandWithBudget = segments.find(
    (s) =>
      (s.intents || []).includes('demand') &&
      (s.slots?.budget != null || s.slots?.money?.amount != null),
  );
  const demandSeg = segments.find((s) => (s.intents || []).includes('demand'));
  const offerSeg = segments.find((s) => (s.intents || []).includes('offer'));

  let primary =
    demandWithBudget ||
    demandSeg ||
    (policyResult?.decision === 'ATTEND' && policyResult.segment_index != null
      ? segments.find((s) => s.index === policyResult.segment_index)
      : null) ||
    offerSeg ||
    segments[segments.length - 1];

  for (const seg of segments) {
    const slots = seg.slots || {};
    const zone = slots.locationText || extractInlineZone(seg.text);
    if (zone && String(zone).length <= 40) {
      if ((seg.intents || []).includes('demand') && (primary.intents || []).includes('demand')) {
        patch.locationText = zone;
      } else if (!patch.locationText && (seg.intents || []).includes('offer')) {
        patch.locationText = zone;
      }
    }
    if (slots.budget != null && (seg.intents || []).includes('demand')) {
      patch.budget = slots.budget;
    }
    if (slots.expectedPrice != null && (seg.intents || []).includes('offer')) {
      patch.expectedPrice = slots.expectedPrice;
    }
    const nameLine = String(seg.text || '').trim();
    const greet = new Set(['hola', 'hello', 'buenas', 'buenos', 'dias', 'tardes', 'noches']);
    const nameWords = nameLine.split(/\s+/).filter(Boolean);
    if (
      segments.length > 1 &&
      nameWords.length === 1 &&
      isLikelyFirstNameOnly(nameLine) &&
      !greet.has(nameLine.toLowerCase()) &&
      !isBareKnownZoneToken(nameLine)
    ) {
      patch.collectedFields = { ...(patch.collectedFields || {}), fullName: nameLine };
    }
  }

  const slots = primary.slots || {};
  if (!patch.locationText && slots.locationText && String(slots.locationText).length <= 40) {
    patch.locationText = slots.locationText;
  }
  if (patch.budget == null && slots.budget != null) patch.budget = slots.budget;
  if (patch.expectedPrice == null && slots.expectedPrice != null) {
    patch.expectedPrice = slots.expectedPrice;
  }
  if (demandSeg && offerSeg) {
    patch.crossIntentPrimaryRail = 'demand';
  }

  if ((primary.intents || []).includes('demand')) {
    patch.leadFlow = 'demand';
    patch.operationType = slots.operationType || 'sale';
  } else if ((primary.intents || []).includes('offer')) {
    patch.leadFlow = 'offer';
    patch.operationType = slots.operationType || 'sale';
  } else if (slots.leadFlow) {
    patch.leadFlow = slots.leadFlow;
    if (slots.operationType) patch.operationType = slots.operationType;
  }

  return patch;
}

module.exports = {
  runUnderstandingLayer,
};
