#!/usr/bin/env node
'use strict';

/**
 * MC-6 — Análisis read-only elegibilidad property-entry (#46).
 * Usage: node scripts/mc6-eligibility-analysis.js [--json] [--days=30]
 */

require('dotenv').config();

const {
  resolvePropertyEntryV3Eligibility,
  resolvePautaPropertyCrmContext,
  isPautaConversation,
} = require('../conversation/pautaDetection');
const { isPropertyAdEntry } = require('../conversation/leadEntryPointRouter');
const { extractPropertyCode } = require('../conversation/propertyIntentResolver');

const QA_PHONE_SUFFIX = '8181877351';
const jsonOut = process.argv.includes('--json');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const DAYS = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;
const F2_SINCE = process.env.MC6_F2_SINCE || '2026-06-06T00:00:00.000Z';

function isQaPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.includes(QA_PHONE_SUFFIX);
}

function isPautaAiState(ai = {}) {
  if (!ai || typeof ai !== 'object') return false;
  if (isPautaConversation(ai)) return true;
  if (ai.property_code || ai.direct_property_code) return true;
  if (ai.interested_property_id || ai.detected_property_id) return true;
  if (ai.campaign_context && typeof ai.campaign_context === 'object') {
    const keys = Object.keys(ai.campaign_context).filter(
      (k) => ai.campaign_context[k] != null && String(ai.campaign_context[k]).trim() !== '',
    );
    if (keys.length) return true;
  }
  return false;
}

function analyzeEligibility(aiState, text, propertyId) {
  const pautaCtx = resolvePautaPropertyCrmContext(aiState, { propertyId });
  const elig = resolvePropertyEntryV3Eligibility({ aiState, text, propertyId });
  const adEntry = isPropertyAdEntry(text || '');
  const codeInText = extractPropertyCode(text || '');
  return {
    eligible: elig.eligible,
    reason: elig.reason,
    pautaCtx,
    isPropertyAdEntry: adEntry,
    codeInText: codeInText || null,
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE credentials');
    process.exit(1);
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(url, key);
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: convs, error } = await supabase
    .from('conversations')
    .select('id, phone, lead_id, ai_state, created_at, updated_at')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const all = convs || [];
  const pauta = all.filter((c) => isPautaAiState(c.ai_state));
  const pautaNonQa = pauta.filter((c) => !isQaPhone(c.phone));

  const { data: gatesPostF2 } = await supabase
    .from('conversation_events')
    .select('conversation_id, payload, created_at')
    .eq('type', 'v3_primary_gate')
    .gte('created_at', F2_SINCE)
    .order('created_at', { ascending: false })
    .limit(500);

  const { data: inboundsPostF2 } = await supabase
    .from('conversation_messages')
    .select('conversation_id, message_text, created_at, direction')
    .eq('direction', 'inbound')
    .gte('created_at', F2_SINCE)
    .order('created_at', { ascending: false })
    .limit(500);

  const firstInboundByConv = new Map();
  for (const m of inboundsPostF2 || []) {
    if (!firstInboundByConv.has(m.conversation_id)) {
      firstInboundByConv.set(m.conversation_id, m);
    }
  }

  const cohortAnalysis = [];
  const exclusionCounts = {};
  let shouldBeEligible = 0;
  let actuallyEligible = 0;

  for (const c of pautaNonQa) {
    const ai = c.ai_state || {};
    const firstMsg = firstInboundByConv.get(c.id);
    const text = firstMsg?.message_text || '';
    const propertyId = ai.interested_property_id || ai.detected_property_id || null;
    const analysis = analyzeEligibility(ai, text, propertyId);

    const hasReferral = !!(ai.whatsapp_referral && Object.keys(ai.whatsapp_referral).length);
    const hasCampaign = !!(ai.campaign_context && Object.keys(ai.campaign_context).length);
    const hasCode = !!(ai.property_code || ai.direct_property_code);
    const propertySpecific = !!(ai.property_specific_intent || ai.direct_property_reference);

    const heuristicShould =
      hasReferral ||
      hasCampaign ||
      (hasCode && (propertySpecific || hasReferral || hasCampaign)) ||
      analysis.isPropertyAdEntry ||
      !!analysis.codeInText;

    if (heuristicShould) shouldBeEligible += 1;
    if (analysis.eligible) actuallyEligible += 1;

    const excl = analysis.eligible ? 'eligible' : analysis.reason || 'unknown';
    exclusionCounts[excl] = (exclusionCounts[excl] || 0) + 1;

    cohortAnalysis.push({
      conversation_id: c.id,
      phone_last4: String(c.phone || '').slice(-4),
      has_referral: hasReferral,
      has_campaign: hasCampaign,
      property_code: ai.property_code || ai.direct_property_code || null,
      property_specific: propertySpecific,
      v3_primary_active: ai.v3_primary_active === true,
      heuristic_should_eligible: heuristicShould,
      eligible: analysis.eligible,
      exclusion_reason: analysis.eligible ? null : analysis.reason,
      pauta_bypass_eligible: analysis.pautaCtx.bypassEligible,
      is_property_ad_entry_text: analysis.isPropertyAdEntry,
      code_in_first_inbound: analysis.codeInText,
      post_f2_inbound: !!firstMsg,
    });
  }

  const gates = gatesPostF2 || [];
  let bypassEvents = 0;
  let allowlistBlock = 0;
  let allowlistMatch = 0;
  let v3Allowed = 0;
  const deploymentHints = {};

  for (const g of gates) {
    const p = g.payload || {};
    if (p.v3_primary_bypass_reason) bypassEvents += 1;
    if (p.v3_primary_block_reason === 'allowlist_no_match' || p.block_reason === 'allowlist_no_match')
      allowlistBlock += 1;
    if (p.is_qa_allowed === true) allowlistMatch += 1;
    if (p.v3_primary_allowed === true) v3Allowed += 1;
    const hint = p.deployment_hint || 'unknown';
    deploymentHints[hint] = (deploymentHints[hint] || 0) + 1;
  }

  const postF2NonQaInbound = (inboundsPostF2 || []).filter((m) => {
    const conv = all.find((c) => c.id === m.conversation_id);
    return conv && !isQaPhone(conv.phone);
  });

  const postF2PautaNonQaInbound = postF2NonQaInbound.filter((m) => {
    const conv = all.find((c) => c.id === m.conversation_id);
    return conv && isPautaAiState(conv.ai_state);
  });

  const report = {
    generated_at: new Date().toISOString(),
    window_days: DAYS,
    f2_since: F2_SINCE,
    cohort: {
      total_conversations: all.length,
      pauta_conversations: pauta.length,
      pauta_non_qa: pautaNonQa.length,
      should_be_eligible_heuristic: shouldBeEligible,
      actually_eligible_resolvePropertyEntryV3Eligibility: actuallyEligible,
      exclusion_counts: exclusionCounts,
    },
    post_f2: {
      gate_events: gates.length,
      property_bypass_events: bypassEvents,
      allowlist_no_match: allowlistBlock,
      allowlist_qa_match: allowlistMatch,
      v3_primary_allowed: v3Allowed,
      deployment_hints: deploymentHints,
      total_inbounds: (inboundsPostF2 || []).length,
      non_qa_inbounds: postF2NonQaInbound.length,
      pauta_non_qa_inbounds: postF2PautaNonQaInbound.length,
    },
    sample_excluded: cohortAnalysis.filter((r) => !r.eligible).slice(0, 15),
    sample_eligible: cohortAnalysis.filter((r) => r.eligible).slice(0, 10),
    conclusions: {
      primary_hypothesis: null,
      volume_vs_logic: null,
    },
  };

  if (postF2PautaNonQaInbound.length === 0 && bypassEvents === 0) {
    report.conclusions.primary_hypothesis = 'lack_of_post_f2_pauta_traffic';
    report.conclusions.volume_vs_logic =
      'Sin inbounds pauta non-QA post-F2; bypass=0 explicado por volumen, no por bug de telemetría.';
  } else if (actuallyEligible > 0 && bypassEvents === 0) {
    report.conclusions.primary_hypothesis = 'eligibility_logic_or_timing_gap';
    report.conclusions.volume_vs_logic =
      'Cohorte histórica elegible pero 0 bypass post-F2 → revisar timing ai_state vs gate o flag deploy.';
  } else if (actuallyEligible === 0 && pautaNonQa.length > 0) {
    report.conclusions.primary_hypothesis = 'eligibility_rules_too_strict';
    report.conclusions.volume_vs_logic =
      'Mayoría cohorte pauta non-QA no pasa resolvePropertyEntryV3Eligibility con ai_state persistido.';
  }

  if (jsonOut) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\nMC-6 Eligibility Analysis (read-only)\n');
    console.log(`Cohorte pauta non-QA (30d): ${pautaNonQa.length}`);
    console.log(`Heuristic should eligible: ${shouldBeEligible}`);
    console.log(`Actually eligible (replay): ${actuallyEligible}`);
    console.log('Exclusion reasons:', exclusionCounts);
    console.log('\nPost-F2:');
    console.log(`  Gate events: ${gates.length}`);
    console.log(`  Property bypass: ${bypassEvents}`);
    console.log(`  Non-QA inbounds: ${postF2NonQaInbound.length}`);
    console.log(`  Pauta non-QA inbounds: ${postF2PautaNonQaInbound.length}`);
    console.log(`\nHypothesis: ${report.conclusions.primary_hypothesis}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
