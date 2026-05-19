# Message Understanding v1 — Contract

## Flag

`PERSEO_MESSAGE_PLANNER_ENABLED=true`

## Pipeline

1. `segmentMessage(text)` → segments
2. `detectSegmentIntents` per segment
3. `extractAllSegmentSlots` → money, zone, leadFlow
4. `evaluatePolicy` (if policy flag ON)
5. `buildResponsePlan` → ordered steps

## Output

| Field | Location |
|-------|----------|
| `segments` | trace `segments`, `state.lastSegments` |
| `response_plan` | trace `response_plan`, `state.lastResponsePlan` |

## Invariants

- Does not send multiple WhatsApp messages per turn
- Sticky M1: short messages after flow set must not reopen global menu
- Policy + planner OFF → zero change to legacy path
