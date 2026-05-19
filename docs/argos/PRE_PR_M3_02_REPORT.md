# PRE-PR M3-02 — WhatsApp Hardening Wave 2 + CRM Execute Foundation

**Branch:** `feat/m3-02-wa-hardening-crm-foundation`  
**Base:** `main` (post M3-01)  
**Estado:** validación completa local — **listo para commit/PR bajo autorización**

## Validación ejecutada (2026-05-19)

| Comando | Resultado |
|---------|-----------|
| `npm run test:argos` | **40/40 PASS** |
| `npm run test:perseo` | **103/103 PASS** |
| `npm run test:corpus` | **7/7 PASS** |
| `npm run corpus-validate` | **PASS** |
| `npm test` (M2+M3 flags **OFF**) | **728/735 PASS**, **7 fail** |
| `npm test` en `main` (flags OFF) | **717/724 PASS**, **7 fail** |
| **Delta vs main** | **+11 tests nuevos, todos PASS**; **0 fallos nuevos** |

### Suites ARGOS (`node scripts/argos-run-suite.js`)

| Suite | Escenarios | Resultado |
|-------|------------|-----------|
| `release-p0` | 7 | **7/7 PASS** |
| `release-p1` | 11 | **11/11 PASS** |
| `policy-p0` | 8 | **8/8 PASS** |
| `cross-intent-p0` | 6 | **6/6 PASS** |
| `media-p0` | 6 | **6/6 PASS** |
| `whatsapp-smoke` | 4 | **4/4 PASS** |
| `wa-hardening-p0` | 8 | **8/8 PASS** |
| `media-real-p0` | 6 | **6/6 PASS** |
| `resilience-p0` | 6 | **6/6 PASS** |
| `humanity-wave2-p0` | 6 | **6/6 PASS** |
| `crm-execute-p0` | 6 | **6/6 PASS** |
| **M3-02 nuevas** | **32** | **32/32 PASS** |
| **Total verificado** | **74** | **74/74 PASS** |

## Archivos para commit (scope M3-02)

### Modificados (9)

- `argos/conversationSnapshot.js`
- `argos/deterministicMode.js`
- `argos/scenarioRunner.js`
- `argos/scenarioTurn.js`
- `conversation/v3/core/v3InboundBridge.js`
- `conversation/v3/core/v3Runtime.js`
- `conversation/v3/crm/crmExecutor.js`
- `conversation/v3/interpreter/locationNormalizer.js`
- `conversation/v3/media/mediaIntakeV1.js`

### Nuevos — runtime (5)

- `config/perseoM302Flags.js`
- `conversation/v3/media/mediaRealBridge.js`
- `conversation/v3/crm/crmExecuteFoundation.js`
- `conversation/v3/resilience/conversationalResilience.js`
- `conversation/v3/humanity/humanityWave2.js`

### Nuevos — ARGOS (37)

- `docs/argos/scenarios/WA2_001` … `WA2_008` (8)
- `docs/argos/scenarios/MREAL_001` … `MREAL_006` (6)
- `docs/argos/scenarios/RES_001` … `RES_006` (6)
- `docs/argos/scenarios/HUM2_001` … `HUM2_006` (6)
- `docs/argos/scenarios/CRM2_001` … `CRM2_006` (6)
- `docs/argos/suites/wa-hardening-p0.json`
- `docs/argos/suites/media-real-p0.json`
- `docs/argos/suites/resilience-p0.json`
- `docs/argos/suites/humanity-wave2-p0.json`
- `docs/argos/suites/crm-execute-p0.json`

### Nuevos — tests (3)

- `test/argosM302Suites.test.js`
- `test/conversationalResilience.test.js`
- `test/crmExecuteFoundation.test.js`

### Fuera de scope commit (no incluir)

- `.github/PR_BODY_*.md`, `.github-pr-body-r0-p012.md`
- `docs/sprints/*.md`
- `docs/argos/issues/*`
- `test/conversationOrchestrator.harness.test.js`
- `test/crmCreationAuditV2.test.js`

`docs/argos/scenarios/manifest.json` **no modificado** — suites M3-02 son adicionales.

## Flags OFF vs ON

| Variable | Default prod | OFF | ON |
|----------|--------------|-----|-----|
| `PERSEO_MEDIA_REAL_V1_ENABLED` | `false` | Sin bridge Whisper/Vision | `mediaRealBridge` + simulates ARGOS |
| `PERSEO_CRM_EXECUTE_FOUNDATION_ENABLED` | `false` | CRM directo (`executeV3CrmIfEligibleImpl`) | Queue in-memory + retry + audit + idempotency |
| `PERSEO_RESILIENCE_V1_ENABLED` | `false` | Sin patch resiliencia | Multi-pregunta, interrupciones, refs ambiguas |
| `PERSEO_HUMANITY_WAVE2_ENABLED` | `false` | Sin tono wave 2 | `finalizeAssistantTurn` + empatía/rapport |
| `PERSEO_WA_HARDENING_V2_ENABLED` | `false` | Comportamiento M3-01 | Hardening wave 2 WA |

ARGOS: `applyArgosSimulationEnv` mapea flags por escenario (`media_real_v1`, `crm_execute_foundation`, etc.).

Con **todos OFF**, `npm test` = baseline `main` + 11 tests nuevos PASS.

Con **todos ON** (M2+M3): ~17 fails documentados (legado M2 planner/policy); no delta nuevo atribuible a M3-02.

## 7 fallos legacy (flags OFF, también en `main`)

1. `V3-F2.3 QA script occupancy anti-loop`
2. `V3-F2 venta mínima` / `guion completo: Hola → venta → Jorge → Cumbres → 8M`
3. `V3-F2 cambio explícito` / `permite pasar a compra`
4. `V3-F2 frustración` / `responde con empatía sin "Listo, retomo"`
5. `F3.2 Luxetty tone` / handoff consentimiento
6. `F4 integration processV3Turn` / `gracias después de ACCEPTED`
7. `tryV3PrimaryReply` / `v3PrimaryGate` (`v3_core_f3_1` vs expect `v3_core_f2` — **también falla en `main`**)

## Dry-run / ARGOS — confirmación

- Escenarios CRM llevan `crm_dry_run: true` y `must_not.write_leads` / `write_contacts`.
- ARGOS usa Supabase no-write (`createArgosNoWriteSupabase`) — sin writes reales a DB.
- `release-p0`, `release-p1`, `policy-p0`, `cross-intent-p0`, `media-p0`, `whatsapp-smoke` sin regresión.
- Snapshot extendido: `resilience_*`, `humanity_tone`, `crm_queue_status`, `tracked_name`.

## CRM execute foundation — confirmación seguridad

- **Solo activo** si `PERSEO_CRM_EXECUTE_FOUNDATION_ENABLED=true`.
- **No añade** llamadas Supabase: envuelve `executeV3CrmIfEligibleImpl` existente (mismos gates + dry-run).
- Cola **in-memory** por `conversationId`; audit vía `v3Log` / `logEvent`.
- Idempotency key + collision guard evitan doble enqueue.
- `reconcileCrmState` detecta estados inconsistentes sin escribir.
- Prod sin flag = path idéntico a pre-M3-02.

## Riesgos

1. Humanity wave 2 puede alargar replies en policy short-circuit (mitigado: `finalizeAssistantTurn` en todos los paths).
2. CRM foundation no persiste entre procesos — outbox DB fuera de alcance.
3. Media real en prod requiere cablear webhook (`index.js`) con `transcribeAudio` / `analyzeImage`.

## Rollback

1. Flags M3-02 → `false` (instantáneo en prod).
2. Revert branch `feat/m3-02-wa-hardening-crm-foundation`.
3. Suites M3-02 aisladas; manifests release históricos intactos.

## Fuera de alcance

ARGOS-2 UI, ATENA, migraciones DB, OCR/Whisper prod en webhook, CRM execute real prod, dashboards, `release-p2`.

## Commit sugerido (tras autorización)

```
feat(m3): wa hardening wave 2, media real, resilience, crm foundation
```
