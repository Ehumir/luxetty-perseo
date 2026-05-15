# PERSEO V3-F2 — Stage + Identity mínimo

**Estado:** implementado en código aislado + allowlist QA.  
**Producción global:** legacy salvo números en `PERSEO_V3_QA_ALLOWLIST` con `PERSEO_V3_ENABLED=true`.

## Qué hace F2

- Stage engine funcional: `NEW` → `UNDERSTANDING` → `IDENTITY_PENDING` → `QUALIFYING` → `PROPERTY_CONTEXT`
- Identity: `UNKNOWN` / `PARTIAL` / `CONFIRMED`; no repite “¿cómo te llamas?” tras nombre
- Ownership: `conversationGoal`, `conversationGoalLocked`, `goalConfidence`
- Interpreter mínimo real (`GREETING`, `SELL_PROPERTY`, `BUY_PROPERTY`, entidades)
- Human Composer V3 (es-MX, sin “house”, sin “dime en una frase”)
- Frustración: respuesta empática
- Shadow: legacy responde; V3 corre en paralelo si `PERSEO_V3_SHADOW_MODE=true`
- Allowlist: solo QA usa V3 como respuesta primaria

## Variables Railway / .env

```env
PERSEO_ENGINE=legacy
PERSEO_V3_ENABLED=false
PERSEO_V3_SHADOW_MODE=false
PERSEO_V3_QA_ALLOWLIST=
PERSEO_V3_LOG=false
```

### QA WhatsApp real (ventana controlada)

```env
PERSEO_V3_ENABLED=true
PERSEO_V3_SHADOW_MODE=true
PERSEO_V3_QA_ALLOWLIST=521XXXXXXXXXX
PERSEO_V3_LOG=true
```

Reiniciar proceso PERSEO tras cambiar env.

## Script de prueba manual

```txt
!reset
Hola
Quiero vender mi casa
Jorge
Está en Cumbres
Vale como 8 millones
```

## Rollback

- `PERSEO_V3_ENABLED=false` o vaciar allowlist → 100 % legacy
- Revert del commit F2

## Riesgos

- Estado V3 en memoria (no sobrevive restart del proceso)
- Allowlist mal configurada podría exponer V3 a número incorrecto
- Fallback a legacy si V3 falla o rule guard bloquea

## Fuera de alcance F2

CRM, contactos, leads, multimedia, Meta, property search, OpenAI global, Supabase persistente V3.
