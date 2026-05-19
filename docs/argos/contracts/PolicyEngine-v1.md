# PolicyEngine v1 — Contract

## Flag

`PERSEO_POLICY_ENGINE_ENABLED=true`

## Input

- `state` — conversation state post-interpreter patch merge
- `decision` — interpreter decision
- `text` — raw user message
- `segments[]` — from Message Planner (`text`, `index`, `intents`, `slots`)

## Output (`policyResult`)

| Field | Type | Description |
|-------|------|-------------|
| `decision` | `ATTEND` \| `QUALIFY` \| `DECLINE_SOFT` \| `HANDOFF` \| `DEFER` | Primary decision |
| `rule_id` | string | e.g. `sale_min_mxn`, `zone_out_of_coverage` |
| `segmentDecisions` | array | Per-segment evaluation |
| `shouldShortCircuit` | boolean | If true, compose policy reply and skip F3/F2 |

## Thresholds (config)

- Sale MXN ≥ 3,000,000
- Sale USD ≥ 150,000
- Rent MXN ≥ 10,000 / month
- Rent USD ≥ 500 / month

## Trace

`debug_trace.policy_decision` — full `policyResult` payload.

## Snapshot

`conversation_snapshot.policy_decision`, `policy_rule_id` from `state.lastPolicyDecision`, `state.lastPolicyRuleId`.
