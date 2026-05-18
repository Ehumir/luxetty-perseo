'use strict';

/**
 * Genera docs/argos/datasets/corpus-index.yaml (~210 entradas).
 * Uso: node scripts/generate-corpus-index.js
 */

const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'docs', 'argos', 'datasets', 'corpus-index.yaml');

/** @type {Record<string, { label: string, family: string, difficulty: string, personality: string, emotional: string, trust: string, verbosity: string, coop: string, risks: object }>} */
const BLOCK_PROFILES = {
  A: {
    label: 'estructurado_ideal',
    family: 'F1',
    difficulty: 'low',
    personality: 'rational_cooperative',
    emotional: 'neutral',
    trust: 'medium_high',
    verbosity: 'medium',
    coop: 'high',
    risks: { hallucination: 'low', loop: 'low', crm: 'medium', ownership: 'low' },
  },
  B: {
    label: 'ambiguo_fragmentado',
    family: 'F4',
    difficulty: 'medium',
    personality: 'distracted_fragmented',
    emotional: 'mild_frustration',
    trust: 'medium',
    verbosity: 'low',
    coop: 'medium',
    risks: { hallucination: 'medium', loop: 'high', crm: 'low', ownership: 'low' },
  },
  C: {
    label: 'exigente_objeciones',
    family: 'F5',
    difficulty: 'medium_high',
    personality: 'skeptical_demanding',
    emotional: 'guarded',
    trust: 'low',
    verbosity: 'medium',
    coop: 'medium_low',
    risks: { hallucination: 'medium', loop: 'medium', crm: 'medium', ownership: 'low' },
  },
  D: {
    label: 'emocional_premium',
    family: 'F6',
    difficulty: 'high',
    personality: 'emotional_urgent',
    emotional: 'elevated',
    trust: 'medium',
    verbosity: 'medium_high',
    coop: 'medium',
    risks: { hallucination: 'low', loop: 'medium', crm: 'high', ownership: 'medium' },
  },
  E: {
    label: 'legal_delicado',
    family: 'F6',
    difficulty: 'high',
    personality: 'cautious_detail',
    emotional: 'anxious',
    trust: 'low',
    verbosity: 'high',
    coop: 'medium',
    risks: { hallucination: 'high', loop: 'low', crm: 'high', ownership: 'medium' },
  },
  F: {
    label: 'crm_continuidad',
    family: 'F7',
    difficulty: 'medium',
    personality: 'returning_user',
    emotional: 'neutral',
    trust: 'medium_high',
    verbosity: 'low',
    coop: 'high',
    risks: { hallucination: 'low', loop: 'medium', crm: 'high', ownership: 'high' },
  },
  G: {
    label: 'premium_listing',
    family: 'F3',
    difficulty: 'medium',
    personality: 'hyper_detailed',
    emotional: 'neutral',
    trust: 'medium',
    verbosity: 'high',
    coop: 'high',
    risks: { hallucination: 'medium', loop: 'low', crm: 'medium', ownership: 'low' },
  },
  H: {
    label: 'caos_abuso',
    family: 'F8',
    difficulty: 'high',
    personality: 'aggressive_chaotic',
    emotional: 'hostile',
    trust: 'very_low',
    verbosity: 'variable',
    coop: 'very_low',
    risks: { hallucination: 'medium', loop: 'very_high', crm: 'low', ownership: 'low' },
  },
};

const DEMAND_BLOCK_INTENT = {
  A: { intent: 'buy', operation: 'sale', outcome: 'qualification_or_crm_ready', stage: 'QUALIFYING' },
  B: { intent: 'buy', operation: 'sale', outcome: 'context_recovery', stage: 'UNDERSTANDING' },
  C: { intent: 'buy', operation: 'sale', outcome: 'objection_handling', stage: 'HANDOFF_PENDING' },
  D: { intent: 'buy', operation: 'sale', outcome: 'empathetic_handoff', stage: 'HANDOFF_PENDING' },
};

const OFFER_BLOCK_INTENT = {
  A: { intent: 'sell', operation: 'sale', outcome: 'qualification_or_crm_ready', stage: 'QUALIFYING' },
  B: { intent: 'sell', operation: 'sale', outcome: 'context_recovery', stage: 'UNDERSTANDING' },
  C: { intent: 'sell', operation: 'sale', outcome: 'objection_handling', stage: 'HANDOFF_PENDING' },
  D: { intent: 'sell', operation: 'sale', outcome: 'empathetic_handoff', stage: 'HANDOFF_PENDING' },
  E: { intent: 'sell', operation: 'sale', outcome: 'legal_safe_handoff', stage: 'HANDOFF_PENDING' },
  F: { intent: 'sell', operation: 'sale', outcome: 'crm_continuity', stage: 'QUALIFYING' },
  G: { intent: 'sell', operation: 'sale', outcome: 'premium_capture', stage: 'QUALIFYING' },
  H: { intent: 'sell', operation: 'sale', outcome: 'forced_handoff', stage: 'HUMAN_ESCALATION' },
};

/** Overrides manuales post-generación (promociones oficiales) */
const PROMOTED = {
  'DEM-A-001': { scenario_code: 'DEMAND_002_FULL', regression_critical: true },
  'DEM-A-002': { scenario_code: 'DEMAND_002_SLOTS', regression_critical: true },
  'DEM-A-003': { scenario_code: 'DEMAND_001', regression_critical: true },
  'DEM-A-010': { scenario_code: 'DEMAND_004', regression_critical: true },
  'CAP-A-001': { scenario_code: 'OFFER_001', regression_critical: true },
  'DEM-B-008': { scenario_code: 'PROP_003', regression_critical: true },
  'CHAOS-001': { scenario_code: 'CHAOS_001', regression_critical: true },
};

function yamlQuote(s) {
  if (s == null) return 'null';
  const t = String(s);
  if (/^[a-z0-9_]+$/i.test(t) && !t.includes(' ')) return t;
  return `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function yamlList(arr) {
  if (!arr || !arr.length) return '[]';
  return `[${arr.map((x) => yamlQuote(x)).join(', ')}]`;
}

function buildEntry(base) {
  const promoted = PROMOTED[base.corpus_id];
  return {
    ...base,
    promoted_to_scenario: !!promoted,
    scenario_code: promoted?.scenario_code || null,
    regression_critical: promoted?.regression_critical || false,
    reusable_patterns: base.reusable_patterns || [],
  };
}

function capEntries() {
  const blocks = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const perBlock = [13, 13, 12, 12, 12, 12, 13, 12];
  const entries = [];
  blocks.forEach((block, bi) => {
    const count = perBlock[bi];
    const prof = BLOCK_PROFILES[block];
    const intent = OFFER_BLOCK_INTENT[block];
    for (let i = 1; i <= count; i += 1) {
      const n = String(i).padStart(3, '0');
      const corpus_id = `CAP-${block}-${n}`;
      const priority =
        block === 'A' && i <= 3 ? 'P0' : block === 'H' && i <= 2 ? 'P0' : block <= 'C' ? 'P1' : 'P2';
      entries.push(
        buildEntry({
          corpus_id,
          source_document: 'tipologia-captadores',
          category: `captacion_${prof.label}`,
          rail: 'offer',
          priority_candidate: priority,
          intent: intent.intent,
          operation_type: intent.operation,
          conversation_stage: intent.stage,
          outcome: intent.outcome,
          slots_present: block === 'A' ? ['zone', 'intent'] : ['intent'],
          slots_missing: block === 'A' ? ['full_name', 'price'] : ['full_name', 'zone', 'price'],
          personality_type: prof.personality,
          emotional_profile: prof.emotional,
          difficulty_level: prof.difficulty,
          trust_level: prof.trust,
          verbosity: prof.verbosity,
          cooperativeness: prof.coop,
          hallucination_risk: prof.risks.hallucination,
          loop_risk: prof.risks.loop,
          crm_risk: prof.risks.crm,
          ownership_risk: prof.risks.ownership,
          family: prof.family,
          typology_block: block,
          behavior_cluster: `offer|${intent.intent}|${intent.outcome}|${prof.family}|${prof.personality}|${prof.difficulty}`,
          dedup_key: corpus_id,
          status: 'active',
          notes: `Captación bloque ${block} caso ${i}`,
          reusable_patterns:
            block === 'A' ? ['greeting_offer', 'ask_name_natural'] : block === 'H' ? ['anti_loop'] : [],
        }),
      );
    }
  });
  return entries;
}

function demEntries() {
  const blocks = ['A', 'B', 'C', 'D'];
  const entries = [];
  blocks.forEach((block) => {
    const prof = BLOCK_PROFILES[block];
    const intent = DEMAND_BLOCK_INTENT[block];
    for (let i = 1; i <= 25; i += 1) {
      const n = String(i).padStart(3, '0');
      const corpus_id = `DEM-${block}-${n}`;
      const priority =
        block === 'A' && i <= 5 ? 'P0' : block === 'B' && i <= 5 ? 'P1' : block === 'C' ? 'P1' : 'P2';
      const rail = block === 'B' && i >= 6 && i <= 10 ? 'property' : 'demand';
      entries.push(
        buildEntry({
          corpus_id,
          source_document: 'tipologia-compradores',
          category: rail === 'property' ? 'demanda_anclada_propiedad' : `compra_${prof.label}`,
          rail,
          priority_candidate: priority,
          intent: block === 'B' && i >= 6 && i <= 10 ? 'property_inquiry' : intent.intent,
          operation_type: intent.operation,
          conversation_stage: intent.stage,
          outcome:
            rail === 'property' ? 'property_qa_or_handoff' : intent.outcome,
          slots_present:
            rail === 'property' ? ['listing_code'] : block === 'A' ? ['zone', 'intent'] : ['intent'],
          slots_missing:
            rail === 'property'
              ? ['full_name']
              : block === 'A'
                ? ['full_name', 'budget']
                : ['full_name', 'zone', 'budget'],
          personality_type: prof.personality,
          emotional_profile: prof.emotional,
          difficulty_level: prof.difficulty,
          trust_level: prof.trust,
          verbosity: prof.verbosity,
          cooperativeness: prof.coop,
          hallucination_risk: rail === 'property' ? 'high' : prof.risks.hallucination,
          loop_risk: prof.risks.loop,
          crm_risk: prof.risks.crm,
          ownership_risk: rail === 'property' ? 'high' : prof.risks.ownership,
          family: prof.family,
          typology_block: block,
          behavior_cluster: `${rail}|${intent.intent}|${intent.outcome}|${prof.family}|${prof.personality}|${prof.difficulty}`,
          dedup_key: corpus_id,
          status: 'active',
          notes: `Demanda bloque ${block} caso ${i}`,
          reusable_patterns:
            block === 'A' ? ['buy_open_search', 'budget_capture'] : rail === 'property' ? ['listing_lookup'] : [],
        }),
      );
    }
  });
  return entries;
}

function humanityEntries() {
  const archetypes = [
    { id: 'HUM-001', personality: 'warm_cooperative', emotional: 'positive', scenario: null },
    { id: 'HUM-002', personality: 'confused', emotional: 'uncertain', scenario: null },
    { id: 'HUM-003', personality: 'blunt_minimal', emotional: 'neutral', scenario: null },
    { id: 'HUM-004', personality: 'emotional_urgent', emotional: 'elevated', scenario: null },
    { id: 'HUM-005', personality: 'topic_switcher', emotional: 'neutral', scenario: null },
    { id: 'HUM-006', personality: 'evasive_identity', emotional: 'guarded', scenario: null },
    { id: 'HUM-007', personality: 'aggressive', emotional: 'hostile', scenario: null },
    { id: 'HUM-008', personality: 'repetitive', emotional: 'frustrated', scenario: null },
  ];
  return archetypes.map((a, idx) =>
    buildEntry({
      corpus_id: a.id,
      source_document: 'argos-humanity-family',
      category: 'humanidad_arquetipo',
      rail: 'humanity',
      priority_candidate: idx === 0 ? 'HUMANITY' : 'HUMANITY',
      intent: 'mixed',
      operation_type: null,
      conversation_stage: 'UNDERSTANDING',
      outcome: 'natural_flow',
      slots_present: [],
      slots_missing: [],
      personality_type: a.personality,
      emotional_profile: a.emotional,
      difficulty_level: 'medium',
      trust_level: 'medium',
      verbosity: 'variable',
      cooperativeness: a.personality.includes('aggressive') ? 'very_low' : 'medium',
      hallucination_risk: 'low',
      loop_risk: a.personality === 'repetitive' ? 'very_high' : 'medium',
      crm_risk: 'low',
      ownership_risk: 'low',
      family: 'HUMANITY',
      typology_block: String.fromCharCode(65 + idx),
      behavior_cluster: `humanity|mixed|natural_flow|HUMANITY|${a.personality}|medium`,
      dedup_key: a.id,
      status: 'active',
      notes: `Arquetipo HUMANITY ${a.personality}`,
      reusable_patterns: ['tone_natural', 'no_robotic_opening'],
      ...(a.scenario
        ? { promoted_to_scenario: true, scenario_code: a.scenario, regression_critical: false }
        : {}),
    }),
  );
}

function chaosEntries() {
  return [
    buildEntry({
      corpus_id: 'CHAOS-001',
      source_document: 'argos-chaos-family',
      category: 'anti_loop',
      rail: 'chaos',
      priority_candidate: 'P0',
      intent: 'greeting',
      operation_type: null,
      conversation_stage: 'UNDERSTANDING',
      outcome: 'loop_detected_or_diversify',
      slots_present: [],
      slots_missing: [],
      personality_type: 'aggressive_chaotic',
      emotional_profile: 'hostile',
      difficulty_level: 'high',
      trust_level: 'very_low',
      verbosity: 'low',
      cooperativeness: 'very_low',
      hallucination_risk: 'low',
      loop_risk: 'very_high',
      crm_risk: 'low',
      ownership_risk: 'low',
      family: 'F8',
      typology_block: 'H',
      behavior_cluster: 'chaos|greeting|loop_detected|F8|aggressive_chaotic|high',
      dedup_key: 'CHAOS-001',
      status: 'active',
      notes: 'Saludos repetidos — escenario CHAOS_001',
      reusable_patterns: ['anti_loop'],
    }),
  ];
}

function edgeEntries() {
  const items = [
    { id: 'EDGE-001', outcome: 'ownership_contact_owner', priority: 'P1' },
    { id: 'EDGE-002', outcome: 'crm_reuse_lead', priority: 'P2' },
    { id: 'EDGE-003', outcome: 'duplicate_whatsapp', priority: 'P2' },
  ];
  return items.map((x) =>
    buildEntry({
      corpus_id: x.id,
      source_document: 'argos-edge-family',
      category: 'edge_crm_assignment',
      rail: 'edge',
      priority_candidate: x.priority,
      intent: 'buy',
      operation_type: 'sale',
      conversation_stage: 'CRM_READY',
      outcome: x.outcome,
      slots_present: ['full_name', 'zone', 'budget'],
      slots_missing: [],
      personality_type: 'rational_cooperative',
      emotional_profile: 'neutral',
      difficulty_level: 'medium',
      trust_level: 'medium_high',
      verbosity: 'medium',
      cooperativeness: 'high',
      hallucination_risk: 'low',
      loop_risk: 'low',
      crm_risk: 'high',
      ownership_risk: 'very_high',
      family: 'F7',
      typology_block: 'E',
      behavior_cluster: `edge|buy|${x.outcome}|F7|rational_cooperative|medium`,
      dedup_key: x.id,
      status: 'active',
      notes: x.outcome,
      reusable_patterns: ['ownership_validation'],
    }),
  );
}

function serializeEntry(e) {
  const lines = [
    `  - corpus_id: ${yamlQuote(e.corpus_id)}`,
    `    source_document: ${yamlQuote(e.source_document)}`,
    `    category: ${yamlQuote(e.category)}`,
    `    rail: ${yamlQuote(e.rail)}`,
    `    priority_candidate: ${yamlQuote(e.priority_candidate)}`,
    `    intent: ${yamlQuote(e.intent)}`,
    `    operation_type: ${e.operation_type ? yamlQuote(e.operation_type) : 'null'}`,
    `    conversation_stage: ${yamlQuote(e.conversation_stage)}`,
    `    outcome: ${yamlQuote(e.outcome)}`,
    `    slots_present: ${yamlList(e.slots_present)}`,
    `    slots_missing: ${yamlList(e.slots_missing)}`,
    `    personality_type: ${yamlQuote(e.personality_type)}`,
    `    emotional_profile: ${yamlQuote(e.emotional_profile)}`,
    `    difficulty_level: ${yamlQuote(e.difficulty_level)}`,
    `    trust_level: ${yamlQuote(e.trust_level)}`,
    `    verbosity: ${yamlQuote(e.verbosity)}`,
    `    cooperativeness: ${yamlQuote(e.cooperativeness)}`,
    `    hallucination_risk: ${yamlQuote(e.hallucination_risk)}`,
    `    loop_risk: ${yamlQuote(e.loop_risk)}`,
    `    crm_risk: ${yamlQuote(e.crm_risk)}`,
    `    ownership_risk: ${yamlQuote(e.ownership_risk)}`,
    `    promoted_to_scenario: ${e.promoted_to_scenario}`,
    `    scenario_code: ${e.scenario_code ? yamlQuote(e.scenario_code) : 'null'}`,
    `    regression_critical: ${e.regression_critical}`,
    `    reusable_patterns: ${yamlList(e.reusable_patterns)}`,
    `    family: ${yamlQuote(e.family)}`,
    `    typology_block: ${yamlQuote(e.typology_block)}`,
    `    behavior_cluster: ${yamlQuote(e.behavior_cluster)}`,
    `    dedup_key: ${yamlQuote(e.dedup_key)}`,
    `    status: ${yamlQuote(e.status)}`,
    `    notes: ${yamlQuote(e.notes)}`,
  ];
  return lines.join('\n');
}

function main() {
  const entries = [
    ...capEntries(),
    ...demEntries(),
    ...humanityEntries(),
    ...chaosEntries(),
    ...edgeEntries(),
  ];
  const byRail = {};
  let promoted = 0;
  for (const e of entries) {
    byRail[e.rail] = (byRail[e.rail] || 0) + 1;
    if (e.promoted_to_scenario) promoted += 1;
  }

  const header = `# ARGOS Corpus Index — generado por scripts/generate-corpus-index.js
# NO editar entradas masivas a mano; usar corpus-overrides o regenerar.
# Governance: docs/argos/datasets/CORPUS-GOVERNANCE-v1.md

corpus_version: 1
updated_at: "${new Date().toISOString().slice(0, 10)}"
generator: generate-corpus-index.js

governance:
  max_promoted_scenarios: 70
  max_promoted_per_dedup_key: 1
  promotion_requires: [unique_outcome, regression_value, clear_expected, qa_approval]

stats:
  total_entries: ${entries.length}
  promoted_count: ${promoted}
  by_rail:
${Object.entries(byRail)
  .map(([k, v]) => `    ${k}: ${v}`)
  .join('\n')}

entries:
`;

  const body = entries.map(serializeEntry).join('\n');
  fs.writeFileSync(OUT, `${header}${body}\n`);
  console.log('Wrote', OUT, 'entries:', entries.length, 'promoted:', promoted);
}

main();
