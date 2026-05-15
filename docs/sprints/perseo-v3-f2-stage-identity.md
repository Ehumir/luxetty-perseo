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

**`PERSEO_ENGINE` no activa V3 primary.** Solo observabilidad en `server_started` (`perseo_engine_requested` / `effective: legacy`).  
Primary en allowlist: `PERSEO_V3_ENABLED=true` + número en `PERSEO_V3_QA_ALLOWLIST`.

```env
PERSEO_ENGINE=legacy
PERSEO_V3_ENABLED=true
PERSEO_V3_SHADOW_MODE=false
PERSEO_V3_QA_ALLOWLIST=5218119086196
PERSEO_V3_LOG=true
```

Formato allowlist: preferir **13 dígitos MX WhatsApp** `521` + 10 dígitos (`5218119086196` para `+52 81 1908 6196`).  
También acepta `8119086196`, `528119086196` o `+52 81 1908 6196` (una entrada; no separar por espacios en la variable).

Con allowlist, **no** hace falta `PERSEO_V3_SHADOW_MODE=true` (evita doble procesamiento). Shadow solo para números **fuera** de allowlist.

Logs de gate (buscar en Railway): `v3_primary_gate`, campos `allowlist_match`, `v3_primary_allowed`, `v3_primary_block_reason`, `inbound_raw`, `inbound_normalized`.

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

## F2.3 — Occupancy capture anti-loop (cierre F2)

- Campo `occupancyStatus` / `occupancy_status` (`libre`, `habitada`, `rentada`, `ocupada`).
- Tras capturar ocupación: stage `READY_FOR_CRM` (sin CRM ni asesor).
- No repite *"¿Está habitada, rentada o libre?"* si ya hay respuesta.
- `!state` muestra `occupancy_status` y `awaiting_field` cuando aplica.

**F2 cerrado** como milestone arquitectónico. Objetivo comercial (contacto asesor) → **F3** (`docs/sprints/perseo-v3-f3-qualification-handoff.md`).

Nota: `READY_FOR_CRM` en código F2 significa “calificación técnica mínima alcanzada”; en F3 se renombrará a `QUALIFICATION_COMPLETE` y el CRM operativo quedará en `CRM_READY`.

## F2.2 — Robustez nombre + tipo inmueble

- **Nombre:** solo se captura en `IDENTITY_PENDING` / tras preguntar nombre; `Nada`, `ya te dije`, etc. no pisan `Jorge`.
- **Tipo:** `Quiero vender mi casa` → `property_type: house`; `Ya te dije que es casa` confirma sin loop.
- **Composer:** sin fallback “¿qué dato quieres afinar?” cuando ya hay zona + precio + tipo; avanza a ocupación.
- **Frustración:** con contexto completo responde resumen + pregunta de ocupación, no repite precio.
- **`!state`:** incluye `property_type` y `expected_price`.

## F2.1 — State + Composer (hotfix)

- **Bridge V3 → `ai_state`:** cada turno V3 primary persiste `lead_flow`, `full_name`, `location_text`, stage, goal, identity en Supabase.
- **`!state`:** lee sesión V3 in-memory + `ai_state`; campos extra: `conversation_stage`, `identity_state`, `conversation_goal`, `goal_locked`, `last_question`.
- **Composer:** no duplica follow-up si ya está en el cuerpo del mensaje.
- **Ubicación:** `Está en San Pedro` → `San Pedro` (`locationNormalizer.js`).

## Fuera de alcance F2

CRM, contactos, leads, multimedia, Meta, property search, OpenAI global, Supabase persistente V3.
