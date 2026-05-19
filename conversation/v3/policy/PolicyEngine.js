'use strict';

const { normalizeText } = require('../../../utils/text');
const { loadPolicyBundle } = require('./policyConfigLoader');
const { parsePolicyMoney } = require('./policyMoney');

const DECISIONS = Object.freeze({
  ATTEND: 'ATTEND',
  QUALIFY: 'QUALIFY',
  DECLINE_SOFT: 'DECLINE_SOFT',
  HANDOFF: 'HANDOFF',
  DEFER: 'DEFER',
});

/**
 * @param {string} zoneText
 * @param {object} zonesConfig
 */
function resolveZoneStatus(zoneText, zonesConfig) {
  const zone = zoneText != null ? String(zoneText).trim() : '';
  if (!zone) return { status: 'missing', zoneId: null, label: null };

  const t = normalizeText(zone);
  for (const out of zonesConfig.explicit_out_of_coverage || []) {
    if (t.includes(normalizeText(out))) {
      return { status: 'out_of_coverage', zoneId: null, label: zone };
    }
  }

  for (const z of zonesConfig.zones || []) {
    for (const pat of z.match_patterns || []) {
      if (t.includes(normalizeText(pat))) {
        return { status: 'active', zoneId: z.id, label: z.label };
      }
    }
    for (const col of z.colonies || []) {
      if (t.includes(normalizeText(col))) {
        return { status: 'active', zoneId: z.id, label: col };
      }
    }
  }

  return { status: 'unknown', zoneId: null, label: zone };
}

/**
 * @param {{ operationType: string, amount: number, currency: string }} input
 * @param {object} commercial
 */
function evaluateMinimum(input, commercial) {
  const mins = commercial.minimums?.[input.operationType];
  if (!mins) return { below: false, rule_id: null };
  const floor = mins[input.currency];
  if (floor == null) return { below: false, rule_id: null };
  if (input.amount < floor) {
    return {
      below: true,
      rule_id: `${input.operationType}_min_${input.currency.toLowerCase()}`,
      floor,
    };
  }
  return { below: false, rule_id: null };
}

/**
 * @param {{
 *   segment: { text: string, index: number, intents?: string[], slots?: object },
 *   state: object,
 * }} ctx
 */
function evaluateSegmentPolicy(ctx) {
  const { commercial, zones } = loadPolicyBundle();
  const segment = ctx.segment || {};
  const text = String(segment.text || '');
  const slots = segment.slots || {};
  const intents = segment.intents || [];
  const isOffer = intents.includes('offer') || slots.leadFlow === 'offer';
  const isDemand = intents.includes('demand') || slots.leadFlow === 'demand';
  const operationType =
    slots.operationType ||
    (isOffer ? 'sale' : isDemand ? ctx.state?.operationType || 'sale' : null);

  const money = slots.money || parsePolicyMoney(text);
  const zoneText = slots.locationText || slots.zone || null;
  const zoneStatus = resolveZoneStatus(zoneText, zones);

  if (zoneStatus.status === 'out_of_coverage') {
    return {
      decision: DECISIONS.DECLINE_SOFT,
      rule_id: 'zone_out_of_coverage',
      segment_index: segment.index,
      amount: money?.amount ?? null,
      currency: money?.currency ?? null,
      zone: zoneText,
    };
  }

  if (money && operationType) {
    const op = money.operationType || operationType;
    const minCheck = evaluateMinimum(
      { operationType: op, amount: money.amount, currency: money.currency },
      commercial,
    );
    if (minCheck.below) {
      return {
        decision: DECISIONS.DECLINE_SOFT,
        rule_id: minCheck.rule_id,
        segment_index: segment.index,
        amount: money.amount,
        currency: money.currency,
        zone: zoneText,
      };
    }
  }

  if (zoneStatus.status === 'active' && (money || isDemand || isOffer)) {
    return {
      decision: DECISIONS.ATTEND,
      rule_id: 'zone_active',
      segment_index: segment.index,
      amount: money?.amount ?? null,
      currency: money?.currency ?? null,
      zone: zoneStatus.label || zoneText,
    };
  }

  if (zoneStatus.status === 'unknown' && zoneText) {
    const action = commercial.ambiguous_zone_action || 'QUALIFY';
    return {
      decision: action === 'HANDOFF' ? DECISIONS.HANDOFF : DECISIONS.QUALIFY,
      rule_id: 'zone_ambiguous',
      segment_index: segment.index,
      zone: zoneText,
    };
  }

  if ((isOffer || isDemand) && !money && !zoneText) {
    return {
      decision: DECISIONS.DEFER,
      rule_id: 'insufficient_policy_data',
      segment_index: segment.index,
    };
  }

  if (isOffer || isDemand) {
    return {
      decision: DECISIONS.QUALIFY,
      rule_id: 'qualify_slots',
      segment_index: segment.index,
    };
  }

  return {
    decision: DECISIONS.ATTEND,
    rule_id: 'no_policy_signal',
    segment_index: segment.index,
  };
}

/**
 * @param {{
 *   state: object,
 *   decision: object,
 *   text: string,
 *   segments: { text: string, index: number, intents?: string[], slots?: object }[],
 * }} input
 */
function evaluatePolicy(input) {
  const segments =
    Array.isArray(input.segments) && input.segments.length
      ? input.segments
      : [{ text: input.text, index: 0, intents: [], slots: {} }];

  const segmentDecisions = segments.map((segment) =>
    evaluateSegmentPolicy({ segment, state: input.state }),
  );

  const declines = segmentDecisions.filter((d) => d.decision === DECISIONS.DECLINE_SOFT);
  const attends = segmentDecisions.filter((d) => d.decision === DECISIONS.ATTEND);
  const qualifies = segmentDecisions.filter(
    (d) => d.decision === DECISIONS.QUALIFY || d.decision === DECISIONS.DEFER,
  );

  let primary = segmentDecisions[0];
  let shouldShortCircuit = false;

  if (declines.length === segments.length) {
    primary = declines[0];
    shouldShortCircuit = true;
  } else if (declines.length && attends.length) {
    primary = attends[0];
    shouldShortCircuit = true;
  } else if (declines.length === 1 && segments.length === 1) {
    primary = declines[0];
    shouldShortCircuit = true;
  } else if (attends.length) {
    primary = attends[attends.length - 1];
  } else if (qualifies.length) {
    primary = qualifies[0];
  }

  const blockingDecline = declines.length ? declines[0] : null;

  return {
    decision: primary.decision,
    rule_id: primary.rule_id,
    segment_index: primary.segment_index,
    amount: primary.amount ?? null,
    currency: primary.currency ?? null,
    zone: primary.zone ?? null,
    segmentDecisions,
    blockingDecline,
    shouldShortCircuit,
    hasDualIntent: segments.length > 1 || segmentDecisions.length > 1,
  };
}

module.exports = {
  DECISIONS,
  evaluatePolicy,
  evaluateSegmentPolicy,
  resolveZoneStatus,
};
