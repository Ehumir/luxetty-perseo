# PRE-PR — M4-05a Conversational Flex Quick Wins

**Fecha:** 2026-05-20  
**Rama:** (local)  
**Alcance:** Quick wins detrás de `PERSEO_CONVERSATIONAL_FLEX_ENABLED` (default OFF). Sin engine completo, sin closure/CRM/gate/prod.

## Resumen

| Criterio | Resultado |
|----------|-----------|
| `conversation-flexibility-p0` | **20/20 PASS** |
| `closure-integrity-p0` | **8/8 PASS** |
| `closure-terminal-ack-p0` | **6/6 PASS** |
| `test/conversationFlexibilityQuickWins.test.js` | **6/6 PASS** |
| `test/argosConversationFlexibilitySuite.test.js` | **1/1 PASS** |
| `npm run test:perseo` | **103/103 PASS** |
| Flag OFF = no-op | Confirmado en unit tests |

## Feature flag

```env
PERSEO_CONVERSATIONAL_FLEX_ENABLED=false   # default
```

ARGOS FLEX: `flags.conversational_flex: true` → `applyArgosSimulationEnv` activa el flag por escenario.

## Quick wins

1. **Money slang MX** — `slangLexicon.js` + hook en `moneyParser.js`
2. **Fuzzy zones** — `typoTolerance.js` + hook en `locationNormalizer.js`
3. **Short ack / consent MX** — `shortReplyLexicon.js` + `consentParser.js` + `minimalInterpreter.js`
4. **Occupancy negation** — `occupancyParser.js` (flex ON corrige `no está libre`)
5. **Telemetry ligera** — `flexTelemetry.js` (opt-in `PERSEO_FLEX_TELEMETRY=true`)

## Regresión ejecutada

```bash
node scripts/argos-run-suite.js --suite conversation-flexibility-p0   # 20/20
node scripts/argos-run-suite.js --suite closure-integrity-p0         # 8/8
node scripts/argos-run-suite.js --suite closure-terminal-ack-p0    # 6/6
node --test test/conversationFlexibilityQuickWins.test.js test/argosConversationFlexibilitySuite.test.js
npm run test:perseo   # 103/103
```

## Notas `npm test` / `test:argos`

- `npm run test:argos` incluye `argosReleaseP0Suite` con fallo previo en `DEMAND_002_FULL` (`expected_contact_would_materialize`) — no introducido por M4-05a.
- `npm test` completo muestra fallos en `v3F6CrmExecution` / `v3PrimaryGate` ajenos a este PR.

## Archivos nuevos

- `config/perseoM405Flags.js`
- `conversation/flexibility/{slangLexicon,typoTolerance,shortReplyLexicon,flexTelemetry}.js`
- `docs/sprints/M4-05-conversational-flexibility-design.md`
- `docs/argos/suites/conversation-flexibility-p0.json`
- `docs/argos/scenarios/FLEX_001.v1.json` … `FLEX_020.v1.json`
- `test/conversationFlexibilityQuickWins.test.js`
- `test/argosConversationFlexibilitySuite.test.js`

## Siguiente

- M4-05b: engine + humanizer (no en este PR).
- Rollout staging: activar flag solo en QA tras review.
