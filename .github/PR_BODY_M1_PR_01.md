## Resumen

**M1-PR-01** introduce percepción humana básica en PERSEO V3: anti-repetición de aperturas, continuidad en flujo **renta demanda**, rapport social, y suite ARGOS **`humanity-p0`** (2 escenarios).

**Sin** ARGOS-2, migraciones, CRM execute, ni cambios al assignment engine.

---

## Alcance

### Motor PERSEO

| Cambio | Descripción |
|--------|-------------|
| `openingVariantPicker.js` | `pickOpeningVariant`, firmas, variantes de apertura, continuidad renta |
| State | `lastAssistantReplySignature`, `consecutiveGreetingTurns` |
| Sticky renta | `RENT_PROPERTY` antes de falso `BUY` en “busco depa en renta”; sin menú global tras intención fijada |
| `SOCIAL_RAPPORT` | Turno “todo bien gracias, ¿y tú?” sin reiniciar menú IVR |
| Anti-repetición | `applyGeneralReplyAntiRepetition` en `f3Pipeline` (solo con goal/flow activo) |
| Snapshot | `operation_type` prioriza `v3State.operationType` |
| CHAOS | Preservado: `hola` repetido mantiene apertura estática para anti-loop ARGOS |

### ARGOS

| Artefacto | Rol |
|-----------|-----|
| `HUMANITY_001.v1.json` | Rapport + renta sin menú repetido T3–T6 |
| `REG_GREETING_001.v1.json` | Saludos variados sin apertura idéntica consecutiva |
| `suites/humanity-p0.json` | Gate M1 percepción (`pass_rate: 1.0`) |
| `mustNotValidator` | `repeated_phrase`, `flow_restart`, `robotic_response` |
| `scenarioRunner` | `lead_flow`, `operation_type`, firmas entre turnos |

### Documentación

- `docs/argos/PERSEO-M1-HUMANITY-STICKY-CONTEXT-v1.md` — rector del bloque M1

---

## Tests (local)

| Comando | Resultado |
|---------|-----------|
| `release-p0` local | **7/7 PASS** |
| `humanity-p0` local | **2/2 PASS** |
| `npm run test:argos` | **22/22** |
| `npm test` | **686/686** |
| `npm run test:perseo` | **103/103** |

---

## Fuera de alcance

- ARGOS-2 / UI / tablas `argos_*`
- Migraciones Supabase
- `PERSEO_V3_CRM_EXECUTE` (sigue `false` en QA)
- Assignment engine / CRM execute
- HUMANITY_002+, `release-p1`, olas P1

---

## Post-merge (obligatorio)

1. Redeploy Railway (`main`)
2. Gate remoto:

```bash
PERSEO_BASE_URL=https://luxetty-agent-production.up.railway.app \
ARGOS_SERVICE_SECRET=<secret> \
node scripts/argos-run-suite.js --suite release-p0 --remote

PERSEO_BASE_URL=https://luxetty-agent-production.up.railway.app \
ARGOS_SERVICE_SECRET=<secret> \
node scripts/argos-run-suite.js --suite humanity-p0 --remote
```

3. Confirmar **7/7** + **2/2**

---

## Relacionado

- Corpus Governance (cerrado): PR #82
- Plan M1: `PERSEO-M1-HUMANITY-STICKY-CONTEXT-v1.md`
