# ARGOS · PERSEO Functional Certification

> Sección de ARGOS para la certificación funcional de PERSEO. Fuente de datos: ejecución determinista del cerebro V3 de producción vía `argos/processInboundForArgos` (sin escrituras). Última corrida: **2026-07-07** · **Veredicto: FAIL**.
>
> **Update 2026-07-21 (Backend Knowledge 100%):** inventario demanda cableado a V3 (`inventoryOptionsTurn` + `PERSEO_INVENTORY_OPTIONS_*`, OFF por defecto). Re-ejecutar cert en canary antes de declarar PASS.

## Veredicto por suite

| Suite | Resultado | Detalle |
|---|---|---|
| Renta | **FAIL** (1/3) | R3 PASS; R1/R2 FAIL |
| Venta / Compra | **FAIL** (0/3) | V1/V2/V3 FAIL |
| Propiedad específica | **FAIL** (2/4) | P3/P4 PASS; P1/P2 FAIL |
| Captación | **FAIL** | Clasificación 3/3 PASS; validaciones obligatorias (solicitud/notificación) FAIL |
| Conversación larga (20) | **FAIL** | Mantiene intención; falla presupuesto/nombre/repetición |
| **Global** | **FAIL** | — |

## PASS/FAIL por caso

| Caso | Mensaje | Veredicto | Motivo principal |
|---|---|---|---|
| R1 | opciones de casas en renta en Cumbres | FAIL | no ofrece opciones con link |
| R2 | renta en Cumbres < 50 mil | FAIL | budget 50,000,000; no ofrece |
| R3 | rentar casa 3 rec y patio | PASS | pregunta zona, mantiene renta |
| V1 | casas en venta en Cumbres | FAIL | no ofrece opciones con link |
| V2 | tengo 5 millones, ¿qué compro? | FAIL | no ofrece opciones |
| V3 | casa en venta con alberca | FAIL | no ofrece opciones |
| P1 | háblame de LUX-A0453 | FAIL | no da precio/zona reales |
| P2 | ¿cuánto cuesta LUX-A0453? | FAIL | no da $4,900,000 (tiene el dato) |
| P3 | ¿tiene alberca? | PASS | no alucina alberca, mantiene contexto |
| P4 | compárala con otra | PASS | no inventa, mantiene contexto |
| C1 | quiero vender mi casa | PASS (clasif.) | detecta captación |
| C2 | casa en Cumbres que quiero rentar | PASS (clasif.) | owner/offer, no muestra inventario |
| C3 | ¿cuánto vale mi casa? | PASS (clasif.) | valuación, no inventa valor |
| C-flow | CF1–CF6 end-to-end | FAIL | no llega a CRM_READY; sin solicitud/notificación |
| LONG_20 | conversación 20 msgs | FAIL | presupuesto/nombre/repetición |

## Evidencia

`docs/argos/evidence/perseo-functional-certification/`
- `PERSEO_FUNCTIONAL_CERTIFICATION_SUMMARY.md` · `PERSEO_FUNCTIONAL_CERTIFICATION.json`
- `RENTAL_OPTIONS_TEST.json` · `SALE_OPTIONS_TEST.json` · `PROPERTY_SPECIFIC_TEST.json`
- `CAPTATION_TEST.json` · `LONG_CONVERSATION_20_MESSAGES.json` · `CRM_NOTIFICATION_AUDIT.json`
- `CAPABILITY_PROBE_INVENTORY.json` · `FAILURE_ANALYSIS.json` · `ARGOS_REPLAY_LINKS.json`

## Replay

Replay determinista: `argos/replay/replayEngine.js` con los `conversation_id` de `ARGOS_REPLAY_LINKS.json`.

## Root cause (resumen)

- **F1 (P0):** ~~motor de inventario solo en legacy~~ **MITIGADO 2026-07-21** — cableado pre-V3 con flag OFF; revalidar canary.
- **F7 (P0):** captación no cierra a CRM_READY (exige precio del vendedor).
- **F2/F3/F4/F5 (P1):** presupuesto "mil", nombre "Corrijo", pregunta de nombre repetida, no expone precio/zona hidratados.
- **F6/F8 (P2):** captura de zona contaminada, composer de comisión en flujo de renta.

## Plan de corrección

`docs/argos/evidence/perseo-functional-certification/CORRECTION_PLAN.md`. Prioridad F1 y F7 (P0).

Runbook Knowledge 100%: `docs/argos/BACKEND_KNOWLEDGE_100_RUNBOOK.md`.
Contrato: `docs/architecture/BACKEND_KNOWLEDGE_UTILIZATION_100.md`.
