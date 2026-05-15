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
| `PERSEO_V3_ENABLED` | `false` | Maestro |
| `PERSEO_V3_QA_ALLOWLIST` | vacío | Teléfonos QA (solo dígitos, separados por coma) |
| `PERSEO_V3_SHADOW_MODE` | `false` | V3 en sombra cuando legacy responde |
| `PERSEO_V3_LOG` | `false` | Logs JSON `[V3]` |

## Pruebas

- `npm test` — 509 passed
- `node scripts/lint.js` — LINT_OK

## Pruebas QA WhatsApp (Railway)

1. Deploy rama con flags QA (no producción abierta).
2. `PERSEO_V3_ENABLED=true`
3. `PERSEO_V3_QA_ALLOWLIST=<tu número>`
4. `!reset` y guion venta arriba.
5. Verificar número no allowlist sigue con legacy.

## Riesgos

- Estado V3 solo en memoria del proceso
- Allowlist incorrecta
- Fallback automático a legacy si V3 falla

## Rollback

- Desactivar `PERSEO_V3_ENABLED` o vaciar allowlist; redeploy SHA anterior.

## Fuera de alcance

CRM, leads, contactos, multimedia, campañas Meta, property matching, OpenAI producción global, Supabase schema V3.
