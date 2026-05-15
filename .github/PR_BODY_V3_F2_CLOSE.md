# PR: V3-F2 milestone + F2.3 occupancy (cierre arquitectónico)

## Resumen

Cierra **V3-F2** como milestone: motor V3 primary en allowlist QA, calificación conversacional venta (nombre, zona, precio, tipo, ocupación), state bridge y `!state` coherente.

Incluye hotfixes F2.1–F2.3 (primary async, state bridge, nombre/tipo, occupancy anti-loop).

**F3 siguiente:** handoff consent asesor + CRM dry-run (sin activar en este PR).

## F2 validado (prod QA)

- V3 primary en allowlist Railway
- Ownership lock venta
- Identidad, zona, precio, tipo persistentes
- `!state` alineado con sesión V3
- Composer humano MX, una pregunta por turno
- Sin rollout global / sin CRM

## F2.3 — Occupancy

- `occupancy_status`: libre | habitada | rentada | ocupada
- No repite pregunta de ocupación tras respuesta
- Stage `READY_FOR_CRM` tras capturar (sin ejecutar CRM)

## QA manual

```txt
!reset
Hola
Quiero vender mi casa
Jorge
No, está en San Pedro
15 millones
Libre
!state
```

PASS: `occupancy_status: libre`, `expected_price: 15000000`, `property_type: house`, sin repetir ocupación.

## Pruebas

- `npm test` — 528 passed
- `node scripts/lint.js` — LINT_OK

## Rollback

- `PERSEO_V3_ENABLED=false` o vaciar allowlist → legacy
- Revert merge commit

## Railway (QA primary)

```env
PERSEO_ENGINE=legacy
PERSEO_V3_ENABLED=true
PERSEO_V3_SHADOW_MODE=false
PERSEO_V3_QA_ALLOWLIST=5218119086196
PERSEO_V3_LOG=true
```
