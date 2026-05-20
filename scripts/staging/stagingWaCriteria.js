'use strict';

/** Humanity ≥4/5 proxy when score stored 0–1 */
const HUMANITY_THRESHOLD = 0.8;

const TIERS = {
  b1: {
    id: 'M4-04B',
    label: 'WhatsApp Smoke B1',
    min_pilots: 3,
    require_pilots_with_messages: 3,
    min_humanity_pass: 2,
    humanity_threshold: HUMANITY_THRESHOLD,
    max_duplicate_pilots: 0,
    max_loop_pilots: 0,
  },
  b2: {
    id: 'M4-04C',
    label: 'WhatsApp Smoke B2',
    min_pilots: 10,
    require_pilots_with_messages: 10,
    min_humanity_pass: 8,
    humanity_threshold: HUMANITY_THRESHOLD,
    max_duplicate_pilots: 0,
    max_loop_pilots: 0,
  },
};

function evaluateWaSmoke(pilots, tierKey = 'b2') {
  const tier = TIERS[tierKey] || TIERS.b2;
  const withMsgs = pilots.filter((p) => p.evidence?.message_count > 0);
  const humanityPass = pilots.filter(
    (p) =>
      p.evidence?.avg_humanity_score != null &&
      p.evidence.avg_humanity_score >= tier.humanity_threshold,
  );
  const dupes = pilots.filter((p) => p.evidence?.duplicate_leads).length;
  const loops = pilots.filter((p) => p.evidence?.loop_signal).length;
  const criticalInvention = pilots.filter((p) => p.evidence?.critical_invention).length;

  const ok =
    withMsgs.length >= tier.require_pilots_with_messages &&
    humanityPass.length >= tier.min_humanity_pass &&
    dupes <= tier.max_duplicate_pilots &&
    loops <= tier.max_loop_pilots &&
    criticalInvention === 0;

  return {
    ok,
    tier: tier.id,
    label: tier.label,
    counts: {
      pilots_total: pilots.length,
      with_messages: withMsgs.length,
      humanity_pass: humanityPass.length,
      duplicate_pilots: dupes,
      loop_pilots: loops,
      critical_inventions: criticalInvention,
    },
    thresholds: tier,
  };
}

module.exports = {
  HUMANITY_THRESHOLD,
  TIERS,
  evaluateWaSmoke,
};
