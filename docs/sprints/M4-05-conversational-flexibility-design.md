# M4-05 — Conversational Flexibility Design

## Objetivo

Reducir rigidez del intérprete V3 (regex/listas) sin tocar closure, CRM, gate ni producción.

## Fases

| Fase | Alcance | Estado |
|------|---------|--------|
| **M4-05a** | Quick wins + flag + suite 20 ARGOS | Esta entrega |
| M4-05b | `conversationFlexibilityEngine` + humanizer | Pendiente |
| M4-05c | STT softener + audio | Pendiente |
| M4-05d/e | Re-smoke pilotos WA con flex ON | Pendiente |

## Feature flag

```env
PERSEO_CONVERSATIONAL_FLEX_ENABLED=true   # default OFF
```

- **OFF:** parsers y ack idénticos al comportamiento previo.
- **ON:** módulos en `conversation/flexibility/*` activos vía hooks mínimos en parsers existentes.

## M4-05a — Quick wins

### A) Money slang MX

Entradas: `10 mdp`, `melones`, `bolas`, `unos 10`, `como 6`, `max 7`, `hasta 8`, `millones aprox`.

Regla: número 1–99 + contexto inmueble/compra/venta → millones. Sin contexto → no inventar (`ambiguous`).

### B) Fuzzy zones

Catálogo: Cumbres, Cumbres Elite, San Pedro, Carretera Nacional, García. Typos leves vía Levenshtein + frases compuestas.

### C) Short ack / consent MX

`sip`, `sí porfa`, `simon`, `jalo`, `arre`, `va`, `ok`, `dale`, `me late` → `ACCEPTED` en turno de handoff.

### D) Occupancy negation

- `no está libre` → `habitada` (no falso positivo `libre`)
- `no vive nadie` / `desocupada` → `libre`
- `la tengo rentada` → `rentada`
- `vive mi familia` → `habitada`

## ARGOS

Suite `conversation-flexibility-p0` (20 escenarios `FLEX_001`–`FLEX_020`).

Cada escenario: `deterministic_mode`, `crm_dry_run`, `conversational_flex: true`.

## Regresión obligatoria

```bash
node scripts/argos-run-suite.js --suite conversation-flexibility-p0
node scripts/argos-run-suite.js --suite closure-integrity-p0
node scripts/argos-run-suite.js --suite closure-terminal-ack-p0
npm run test:argos
npm run test:perseo
npm test
```

## Archivos

| Crear | Modificar (mínimo) |
|-------|-------------------|
| `config/perseoM405Flags.js` | `moneyParser.js` |
| `conversation/flexibility/*` | `locationNormalizer.js` |
| `docs/argos/suites/conversation-flexibility-p0.json` | `consentParser.js` |
| `docs/argos/scenarios/FLEX_*.v1.json` | `minimalInterpreter.js` (short ack) |
| `test/conversationFlexibilityQuickWins.test.js` | `occupancyParser.js` |
| `test/argosConversationFlexibilitySuite.test.js` | `.env.example`, `argos/deterministicMode.js` |

## Fuera de alcance (M4-05a)

- `closureIntegrity.js`, `conversationReopenPolicy.js`, CRM executor, worker, `v3InboundBridge` gate, assignment, producción.
