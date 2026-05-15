## Summary

Implementa **F3.1 — Qualification + Handoff Consent Foundation** sobre el núcleo V3 estabilizado en F2, sin CRM real ni planner avanzado.

PERSEO se presenta como **Asesor IA de Luxetty**, califica con slots mínimos invisibles al usuario, ofrece handoff consultivo premium y captura **consentimiento de contacto con asesor** antes de armar un **payload CRM en dry-run** (sin `create lead`).

Arquitectura respetada: **Interpreter extrae → Planner decide → Composer redacta** (flag `PERSEO_V3_HANDOFF_ENABLED`).

## Alcance incluido

- Persona oficial: saludo *"Hola, soy el asesor IA de Luxetty…"*
- Planner base de calificación (`sellOffer`, `buyDemand`, `rentOffer`, `rentDemand`)
- Slots mínimos por flujo (sin `owner_relation`)
- Stages: `QUALIFICATION_COMPLETE` → `HANDOFF_PENDING` → `HANDOFF_READY` → `CRM_READY`
- `advisor_contact_consent`: `UNKNOWN | REQUESTED | ACCEPTED | DECLINED`
- Anti-loop vía planner (no re-pregunta slots llenos)
- `!state` expandido: `qualification_complete`, `advisor_contact_consent`, `handoff_stage`, `crm_payload_ready`, `qualification_missing_slots`
- CRM dry-run: `crm/payloadBuilder.js` + log estructurado `crm_dry_run_payload`

## Fuera de alcance (F3.1)

- Planner/scoring/urgency avanzados
- CRM real, assignment, Meta Ads, multimedia, property matching, rollout global

## Archivos principales

| Área | Archivos |
|------|----------|
| Planner | `conversation/v3/planner/*` |
| Pipeline F3 | `conversation/v3/core/f3Pipeline.js` |
| Composer | `conversation/v3/composer/slotTemplates.js`, `plannerComposer.js` |
| CRM dry-run | `conversation/v3/crm/payloadBuilder.js` |
| Runtime | `conversation/v3/core/v3Runtime.js` |
| Flags | `config/perseoV3Flags.js`, `.env.example` |
| Bridge QA | `conversation/v3/state/v3ToLegacyAiState.js`, `conversation/qaSprint1Commands.js` |
| Tests | `test/v3F31Handoff.test.js` |

## Variables Railway (QA)

```env
PERSEO_ENGINE=legacy
PERSEO_V3_ENABLED=true
PERSEO_V3_SHADOW_MODE=false
PERSEO_V3_HANDOFF_ENABLED=true
PERSEO_V3_CRM_DRY_RUN=true
PERSEO_V3_QA_ALLOWLIST=<tu_numero>
PERSEO_V3_LOG=true
```

**Rollback rápido:** `PERSEO_V3_HANDOFF_ENABLED=false` → vuelve composer F2 sin tocar datos.

## Test plan

### Automatizado
- [x] `npm test` (534 tests, incluye `test/v3F31Handoff.test.js`)

### QA manual WhatsApp (guion PASS F3.1)

```txt
!reset
Hola
Quiero vender mi casa
Jorge
En San Pedro
15 millones
Libre
Sí, que me contacte un asesor
!state
```

**Esperado:**
- [ ] Saludo como Asesor IA de Luxetty
- [ ] `SELL_PROPERTY` estable, sin loops de occupancy/zona/nombre
- [ ] Handoff consultivo (no tono “¿quieres un asesor?” robótico)
- [ ] `advisor_contact_consent: ACCEPTED`
- [ ] `qualification_complete: true`
- [ ] `crm_payload_ready: true`
- [ ] `conversation_stage: CRM_READY`
- [ ] **No** se crea lead real en ATENA/CRM

### Regresión F2
- [ ] Con `PERSEO_V3_HANDOFF_ENABLED=false`, guiones F2.2/F2.3 siguen PASS

## Riesgos conocidos

| Riesgo | Mitigación |
|--------|------------|
| Handoff activo en prod sin QA | Flag default `false`; solo allowlist + env explícito |
| Consent ambiguo (“ok” fuera de contexto) | Parser solo cuando `awaitingField=advisor_contact_consent` o `REQUESTED` |
| Stage `READY_FOR_CRM` legacy en F2 | Se mantiene sin handoff; F3.1 usa stages nuevos |
| Buy/rent flows menos ejercitados que venta | Planner unificado; ampliar tests en F3.2 |

## Checklist reviewer

- [ ] Confirmar que no hay `createLead` ni llamadas CRM reales
- [ ] Verificar que `humanComposer` no acumula lógica comercial nueva (ruta F3 usa `slotTemplates`)
- [ ] Probar rollback con flag off en mismo deploy
