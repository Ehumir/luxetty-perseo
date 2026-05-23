# Cuarzo V1 P0 — PERSEO changelog

**Base SHA:** `71b86cf` (origin/main)

## P0-A — Estabilidad conversacional

- `conversation/cuarzoHandoff.js` — handoff terminal, post-handoff ACK/hold, `handoff_summary`
- `conversation/antiLoopGuardrails.js` — markers repetición, sticky slots
- `conversation/humanEscalation.js` — escalación explícita + resumen
- `conversation/conversationReopenPolicy.js` — `handoff_sent` bloquea calificación
- `conversation/r0ContextContinuity.js` — no repregunta slots capturados
- `index.js` — wiring + evento `cuarzo_handoff_summary`

## P0-C — Fallback honesto

- `conversation/cuarzoFallbacks.js` — legal, multimedia, intención ambigua

## Tests

- `test/cuarzoP0Regression.test.js` — regresión transcript 5640
- `test/qaMatrixP0ConversationalHarness.js` — alineado a handoff Cuarzo

## Fuera de alcance (no incluido)

- PRE-engine, flex prod, CRM execute masivo, migraciones
