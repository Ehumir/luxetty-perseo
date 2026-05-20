# M4-05a — Staging WA Smoke (flex ON)

**NO producción.** Solo Railway QA / staging con allowlist.

## 1. Activar flag (Railway QA)

```env
PERSEO_CONVERSATIONAL_FLEX_ENABLED=true
PERSEO_V3_ENABLED=true
PERSEO_V3_QA_ALLOWLIST=<teléfono piloto>
```

Verificar deploy y reinicio del servicio webhook.

## 2. Preparación

1. `!reset` desde el teléfono piloto.
2. Confirmar gate V3:

```bash
node scripts/staging-query-v3-gate.js <phone>
```

Esperado: `v3_primary_allowed: true`, `last_outbound_response_source` ∈ `v3_core_f2` | `v3_core_f3_1` | `v3_core_f4` | `v3_policy_cross`.

## 3. Smokes (mensajes exactos)

| ID | Mensaje | Esperado |
|----|---------|----------|
| **FLEX1** | `Hola busco casa en cumpres elite como de unos 6 melones` | `location_text` ≈ Cumbres Elite; `budget_max` ≈ 6_000_000; sin menú global ni loop |
| **FLEX2** | Tras handoff pendiente: `Simón jalo` | `advisor_contact_consent` = ACCEPTED; no UNKNOWN |
| **FLEX3** | En captación: `No está libre, vive mi familia ahí` | `occupancy_status` = habitada; **no** libre |
| **FLEX4** | Audio corto (~5–10 s) con typo (“casa en cunbres seis melones”) | Sin `fallback_consultive` agresivo; sin menú IVR; sin loop |

## 4. Captura evidencia

Por cada smoke:

- Screenshot WhatsApp (inbound + outbound).
- Consulta DB:

```bash
node scripts/staging-wa-flex-smoke-check.js <phone> FLEX1
```

- Pegar JSON en `FLEX_STAGING_SMOKE_RESULTS.md`.

## 5. Telemetría `flex_applied`

Con `PERSEO_FLEX_TELEMETRY=true` (opcional QA) o evento `perseo_flex_applied` si está cableado en bridge.

Mínimo en script local (pre-merge): `node scripts/m405a-noop-verify.js` → `flex_telemetry` vacío OFF / >0 ON.

## 6. Criterio GO merge

- [ ] 4 smokes PASS visual + DB
- [ ] `response_source` V3 en todos los outbound
- [ ] NO-OP doc PASS (`docs/argos/evidence/M4-05A-NOOP-VERIFICATION.md`)
- [ ] Closure suites 8/8 + 6/6 sin regresión

**NO mergear a `main` hasta completar checklist.**
