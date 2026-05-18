'use strict';

/**
 * Valida corpus-index.yaml (estructura, duplicados, gaps).
 * Uso:
 *   node scripts/validate-corpus-index.js
 *   node scripts/validate-corpus-index.js --duplicates
 *   node scripts/validate-corpus-index.js --gaps
 */

const fs = require('node:fs');
const path = require('node:path');

const INDEX_PATH = path.join(__dirname, '..', 'docs', 'argos', 'datasets', 'corpus-index.yaml');

const REQUIRED_ENTRY_KEYS = [
  'corpus_id',
  'source_document',
  'category',
  'rail',
  'priority_candidate',
  'intent',
  'conversation_stage',
  'outcome',
  'slots_present',
  'slots_missing',
  'personality_type',
  'emotional_profile',
  'difficulty_level',
  'trust_level',
  'verbosity',
  'cooperativeness',
  'hallucination_risk',
  'loop_risk',
  'crm_risk',
  'ownership_risk',
  'promoted_to_scenario',
  'regression_critical',
  'reusable_patterns',
  'family',
  'typology_block',
  'dedup_key',
  'status',
];

const CRITICAL_COVERAGE = [
  { rail: 'demand', family: 'F1', personality_type: 'rational_cooperative' },
  { rail: 'demand', family: 'F4', personality_type: 'distracted_fragmented' },
  { rail: 'demand', family: 'F5', personality_type: 'skeptical_demanding' },
  { rail: 'demand', family: 'F6', personality_type: 'emotional_urgent' },
  { rail: 'offer', family: 'F1', personality_type: 'rational_cooperative' },
  { rail: 'property', family: 'F4', personality_type: 'distracted_fragmented' },
  { rail: 'humanity', family: 'HUMANITY', personality_type: 'warm_cooperative' },
  { rail: 'chaos', family: 'F8', personality_type: 'aggressive_chaotic' },
];

function parseSimpleYaml(text) {
  const entries = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('  - corpus_id:')) {
      if (current) entries.push(current);
      current = { corpus_id: line.split(':')[1].trim().replace(/^"|"$/g, '') };
    } else if (current && line.match(/^    [a-z_]+:/)) {
      const m = line.match(/^    ([a-z_]+):\s*(.*)$/);
      if (!m) continue;
      let val = m[2].trim();
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (val === 'null') val = null;
      else if (val.startsWith('[')) {
        val = val
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^"|"$/g, ''))
          .filter(Boolean);
      } else val = String(val).replace(/^"|"$/g, '');
      current[m[1]] = val;
    }
  }
  if (current) entries.push(current);
  return entries;
}

function checkDuplicates(entries) {
  const byCluster = new Map();
  const byId = new Set();
  const byScenario = new Map();
  const issues = [];
  for (const e of entries) {
    if (byId.has(e.corpus_id)) issues.push({ code: 'duplicate_id', corpus_id: e.corpus_id });
    byId.add(e.corpus_id);
    const cluster = e.behavior_cluster || e.dedup_key;
    const list = byCluster.get(cluster) || [];
    list.push(e.corpus_id);
    byCluster.set(cluster, list);
    if (e.promoted_to_scenario === true && e.scenario_code) {
      const sc = byScenario.get(e.scenario_code) || [];
      sc.push(e.corpus_id);
      byScenario.set(e.scenario_code, sc);
    }
  }
  for (const [key, ids] of byScenario) {
    if (ids.length > 1) {
      issues.push({ code: 'multiple_corpus_same_scenario', scenario_code: key, corpus_ids: ids });
    }
  }
  if (process.argv.includes('--strict-clusters')) {
    for (const [key, ids] of byCluster) {
      if (ids.length > 3) {
        issues.push({ code: 'behavior_cluster_large', behavior_cluster: key, count: ids.length });
      }
    }
  }
  return issues;
}

function checkGaps(entries) {
  const active = entries.filter((e) => e.status === 'active');
  const gaps = [];
  for (const need of CRITICAL_COVERAGE) {
    const found = active.some(
      (e) =>
        e.rail === need.rail &&
        e.family === need.family &&
        (need.personality_type ? e.personality_type === need.personality_type : true),
    );
    if (!found) gaps.push(need);
  }
  if (!active.some((e) => e.rail === 'chaos')) gaps.push({ rail: 'chaos', family: 'F8' });
  return gaps;
}

function main() {
  const flags = new Set(process.argv.slice(2));
  const text = fs.readFileSync(INDEX_PATH, 'utf8');
  const entries = parseSimpleYaml(text);
  let exitCode = 0;

  if (!flags.size || flags.has('--structure')) {
    for (const e of entries) {
      for (const k of REQUIRED_ENTRY_KEYS) {
        if (!(k in e)) {
          console.error('missing field', e.corpus_id, k);
          exitCode = 1;
        }
      }
      if (e.promoted_to_scenario && !e.scenario_code) {
        console.error('promoted without scenario_code', e.corpus_id);
        exitCode = 1;
      }
    }
    console.log('entries', entries.length, 'structure', exitCode === 0 ? 'ok' : 'fail');
  }

  if (!flags.size || flags.has('--duplicates')) {
    const dup = checkDuplicates(entries);
    if (dup.length) {
      console.error('duplicate issues:', JSON.stringify(dup, null, 2));
      exitCode = 1;
    } else {
      console.log('duplicates: ok');
    }
  }

  if (!flags.size || flags.has('--gaps')) {
    const gaps = checkGaps(entries);
    if (gaps.length) {
      console.error('coverage gaps:', JSON.stringify(gaps, null, 2));
      exitCode = 1;
    } else {
      console.log('gaps: ok');
    }
  }

  process.exit(exitCode);
}

main();
