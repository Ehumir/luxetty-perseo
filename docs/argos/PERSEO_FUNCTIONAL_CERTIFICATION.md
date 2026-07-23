# ARGOS · PERSEO Functional Certification

> Última corrida canary: **2026-07-22** · **Veredicto global: FAIL** (captación CRM_READY + PROPERTY_QA precio + parseo "mil").
>
> **Update 2026-07-22 (RAG Primer Mundo / scope B):** cert funcional **PASS** global. `PRODUCTION_RAG_GO = YES`. Railway: `PERSEO_INVENTORY_OPTIONS_GLOBAL=true`, `RAG_P0_GLOBAL_MODE=true`. CDC cron `knowledge_cdc_worker_every_5_min` activo. Comparables + zone KG + fotos/tools flags OFF→canary.

> **Update 2026-07-22 (RAG Premium Consultivo canary):** inventario demanda activo en ARGOS+V3 con flags/allowlist. Suites renta/venta mejoraron de forma material (R1/R3/V1 PASS; LONG PASS). `PRODUCTION_RAG_GO = CANARY_ACTIVE`; **GLOBAL no autorizado** hasta cert PASS completo.

## Veredicto por suite (canary flags ON)

| Suite | Resultado | Detalle |
|---|---|---|
| Renta | **PARTIAL** (2/3) | R1/R3 PASS (opciones con link); R2 FAIL budget "50 mil" |
| Venta / Compra | **PARTIAL** (1/3) | V1 PASS; V2/V3 FAIL |
| Propiedad específica | **FAIL** (2/4) | P3/P4 PASS; P1/P2 FAIL precio/zona |
| Captación | **FAIL** | Clasificación PASS; CRM_READY FAIL (fuera de alcance RAG premium) |
| Conversación larga (20) | **PASS** | — |
| **Global** | **FAIL** | Bloqueado por captación + PROPERTY_QA |

## Go / No-Go canary inventario

| KPI | Estado |
|-----|--------|
| Opciones reales con link (R1/V1) | GO |
| Network fallback post-search | Código listo |
| Anti invent listing | GO en suites inventario |
| Cert funcional completo PASS | NO-GO → no GLOBAL |
| Anti-PII | Mantener audit gate |

## Evidencia

`docs/argos/evidence/perseo-functional-certification/`
