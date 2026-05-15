# PR: V3-F2 — Stage + Identity mínimo (conversación controlada QA)

## Objetivo

Primer sprint donde **V3 conversa** de forma controlada (solo allowlist QA), con continuidad humana mínima en venta/compra, sin CRM real ni reemplazo global del legacy.

## Comportamiento esperado

### Venta (allowlist)

```txt
!reset → Hola → Quiero vender mi casa → Jorge → Cumbres → 8 millones
```

- Mantiene `offer` / `SELL_PROPERTY` locked
- Usa “Jorge”; no repite pedido de nombre
- `expectedPrice` (no `budget` comprador)
- Tono humano MX; sin “house” / “dime en una frase” / “Listo, retomo…”

### Resto de números

- Legacy responde (sin cambio)
- Si `PERSEO_V3_SHADOW_MODE=true`, V3 corre en sombra y loguea diff

## Alcance

- `conversation/v3/`: interpreter, composer, ownership, session in-memory, runtime, shadow, inbound bridge
- `index.js`: hook mínimo (V3 primary allowlist, shadow, skip CRM en V3 primary, clear session en `!reset`)
- `config/perseoV3Flags.js`: allowlist + routing
- Tests: `test/v3F2Conversation.test.js` + actualizaciones F1

## Feature flags

| Variable | Default | Uso |
|----------|---------|-----|
| `PERSEO_ENGINE` | `legacy` | **No** activa V3 primary; solo log startup |
| `PERSEO_V3_ENABLED` | `false` | Maestro allowlist primary |
| `PERSEO_V3_QA_ALLOWLIST` | vacío | QA: `521`+10 dígitos o equivalente MX (coma entre números) |
| `PERSEO_V3_SHADOW_MODE` | `false` | Shadow solo **fuera** de allowlist; en QA primary usar `false` |
| `PERSEO_V3_LOG` | `false` | Logs JSON `[V3]` + evento `v3_primary_gate` |

## Pruebas

- `npm test` — 509 passed
- `node scripts/lint.js` — LINT_OK

## Pruebas QA WhatsApp (Railway)

1. Deploy rama con F2 + hotfix gate.
2. `PERSEO_ENGINE=legacy` (ok)
3. `PERSEO_V3_ENABLED=true`
4. `PERSEO_V3_QA_ALLOWLIST=5218119086196` (13 dígitos; ver `inbound_normalized` en log)
5. `PERSEO_V3_SHADOW_MODE=false` en QA primary
6. `!reset` y guion venta arriba → `response_source: v3_core_f2`, evento `v3_primary_reply`
7. Log `v3_primary_gate`: `allowlist_match=true`, `v3_primary_allowed=true`
8. Número no allowlist → legacy; shadow solo si `PERSEO_V3_SHADOW_MODE=true`

## Riesgos

- Estado V3 solo en memoria del proceso
- Allowlist incorrecta
- Fallback automático a legacy si V3 falla

## Rollback

- Desactivar `PERSEO_V3_ENABLED` o vaciar allowlist; redeploy SHA anterior.

## Fuera de alcance

CRM, leads, contactos, multimedia, campañas Meta, property matching, OpenAI producción global, Supabase schema V3.
